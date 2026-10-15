require('reflect-metadata');
const { test }=require('node:test');const assert=require('node:assert/strict');const {randomUUID,randomBytes}=require('node:crypto');
const url=process.env.TEST_DATABASE_URL;
if(!url||new URL(url).pathname!=='/agentgate_test')throw new Error('TEST_DATABASE_URL must target agentgate_test');
Object.assign(process.env,{DATABASE_URL:url,NODE_ENV:'test',LOG_LEVEL:'silent',JWT_ACCESS_SECRET:randomBytes(32).toString('hex'),POLICY_RULES_JSON:'[]',REFUND_BUDGETS_JSON:'[]',ACTION_ENVIRONMENT:'development',FAKE_EXECUTION_ENABLED:'false'});
const {createApplication}=require('../dist/bootstrap.js');
const {PrismaService}=require('../dist/infrastructure/database/prisma.service.js');
const {AgentKeyService}=require('../dist/agent-credentials/agent-key.service.js');
const {ExecutionsService}=require('../dist/executions/executions.service.js');
const {PolicyStore}=require('../dist/policies/policy-store.js');
const {PolicyEngine}=require('../dist/policies/policy-engine.js');
const {ConfigService}=require('@nestjs/config');const {JwtService}=require('@nestjs/jwt');

test('policy studies remain non-executing, scoped, redacted, immutable and distinct from authorization',async()=>{
 const app=await createApplication(),db=app.get(PrismaService),org=randomUUID(),foreign=randomUUID(),users=[randomUUID(),randomUUID(),randomUUID()];
 const scope={organizationId:{in:[org,foreign]}};let policy='DENY';
 try{
  await app.init();await app.getHttpAdapter().getInstance().ready();
  app.get(PolicyStore).forOrganization=organizationId=>[{organizationId,actionName:'refund.create',effect:policy,conditions:[]}];
  const identities=[];
  for(const organizationId of [org,foreign]){
   await db.organization.create({data:{id:organizationId,name:'Study lab'}});
   const agent=await db.agent.create({data:{organizationId,name:'study-agent'}});
   const key=app.get(AgentKeyService).generate();const c=await db.agentCredential.create({data:{organizationId,agentId:agent.id,keyPrefix:key.keyPrefix,keyHash:key.keyHash}});
   identities.push({organizationId,agentId:agent.id,credentialId:c.id,apiKey:key.apiKey});
  }
  for(const id of users)await db.user.create({data:{id,email:id+'@example.test',passwordHash:'unused'}});
  await db.organizationMember.createMany({data:[{organizationId:org,userId:users[0],role:'OWNER'},{organizationId:org,userId:users[1],role:'MEMBER'}]});
  const jwt=await Promise.all(users.map(sub=>app.get(JwtService).signAsync({sub})));
  const send=(method,path,payload,token=identities[0].apiKey)=>app.inject({method,url:path,headers:{authorization:'Bearer '+token},...(payload===undefined?{}:{payload})});
  const body={action:{name:'refund.create'},arguments:{paymentId:'private_customer_payment',amountMinor:6000,currency:'USD'}};
  const counts=async()=>Promise.all([db.execution.count({where:scope}),db.executionAttempt.count({where:scope}),db.approval.count({where:scope}),db.refundBudgetReservation.count({where:scope}),db.fakeProviderReceipt.count({where:scope})]);
  const initial=await counts();
  let observed;
  for(const effect of ['DENY','REQUIRE_APPROVAL','ALLOW']){
   policy=effect;const r=await send('POST','/v1/actions/observe',body);assert.equal(r.statusCode,200,r.body);observed=r.json();
   assert.equal(observed.results[0].decision,effect);assert.equal(observed.executed,false);assert.equal(observed.authorizationGranted,false);
   assert.equal(r.body.includes('private_customer_payment'),false);assert.equal(r.body.includes('amountMinor'),false);
   assert.deepEqual(await counts(),initial);
  }
  const studyPath='/v1/organizations/'+org+'/policy-observations';
  for(const token of jwt.slice(0,2))assert.equal((await send('GET',studyPath+'/'+observed.id,undefined,token)).statusCode,200);
  assert.equal((await send('GET',studyPath+'/'+observed.id,undefined,jwt[2])).statusCode,404);
  assert.equal((await send('GET','/v1/organizations/'+foreign+'/policy-observations/'+observed.id,undefined,jwt[0])).statusCode,404);
  const page=(await send('GET',studyPath+'?limit=1',undefined,jwt[1])).json();assert.equal(page.items.length,1);assert.ok(page.nextCursor);
  const page2=(await send('GET',studyPath+'?limit=1&cursor='+page.nextCursor,undefined,jwt[1])).json();assert.notEqual(page.items[0].id,page2.items[0].id);
  assert.equal((await send('POST','/v1/actions/observe',{...body,organizationId:foreign})).statusCode,400);
  assert.equal((await send('POST','/v1/actions/observe',{...body,policies:[]})).statusCode,400);
  assert.equal((await send('POST','/v1/actions/observe',body,'bad')).statusCode,401);
  await assert.rejects(db.policyStudy.update({where:{id:observed.id},data:{policyHash:'b'.repeat(64)}}));
  // Historical rows originate in the ordinary receipt path, not a simulation-specific execution.
  const service=app.get(ExecutionsService);
  const make=async(identity,key)=>service.receive({organizationId:identity.organizationId,principal:{type:'agent',id:identity.agentId},action:body.action,arguments:body.arguments,resource:{type:'payment',id:body.arguments.paymentId},context:{environment:'development',requestedAt:new Date()}},key,()=>({policyDecision:'DENY',policyReason:'MATCHED_DENY',policyHash:'a'.repeat(64),policyEvaluatedAt:new Date()}));
  const e=await make(identities[0],'history'),other=await make(identities[1],'foreign');
  const legacy=await db.execution.create({data:{organizationId:org,agentId:identities[0].agentId,actionName:'refund.create',arguments:body.arguments,environment:'development',requestedAt:new Date()}});
  const candidate={executionIds:[e.id,legacy.id],policies:[{actionName:'refund.create',effect:'ALLOW',conditions:[]}]};
  const simPath='/v1/organizations/'+org+'/policy-simulations';const before=await counts();
  let r=await send('POST',simPath,candidate,jwt[0]);assert.equal(r.statusCode,200,r.body);
  const simulated=r.json();assert.deepEqual(simulated.summary,{allow:1,deny:0,requireApproval:0,skipped:1});
  assert.equal(simulated.results[0].recordedDecision,'DENY');assert.equal(simulated.results[0].decision,'ALLOW');
  assert.equal(simulated.results[1].skipped,'MISSING_POLICY_EVIDENCE');
  assert.deepEqual(await counts(),before);assert.equal((await db.execution.findUniqueOrThrow({where:{id:e.id}})).policyDecision,'DENY');
  assert.equal((await send('POST',simPath,candidate,jwt[1])).statusCode,403);
  assert.equal((await send('POST',simPath,candidate,jwt[2])).statusCode,404);
  assert.equal((await send('POST',simPath,{...candidate,executionIds:[other.id]},jwt[0])).statusCode,404);
  for(const invalid of [{...candidate,executionIds:[e.id,e.id]},{...candidate,executionIds:Array.from({length:101},()=>randomUUID())},{...candidate,policies:[{...candidate.policies[0],organizationId:foreign}]}])assert.equal((await send('POST',simPath,invalid,jwt[0])).statusCode,400);
  // Candidate ALLOW cannot upgrade an actual frozen DENY.
  app.get(ConfigService).set('FAKE_EXECUTION_ENABLED',true);policy='ALLOW';
  r=await app.inject({method:'POST',url:'/v1/actions',headers:{authorization:'Bearer '+identities[0].apiKey,'idempotency-key':'history'},payload:body});
  assert.equal(r.statusCode,403,r.body);assert.equal(r.json().code,'POLICY_DENIED');assert.deepEqual(await counts(),before);
  // Persisted hash mismatch is explicitly skipped, never guessed into an allow.
  const corrupt=await db.execution.create({data:{organizationId:org,agentId:identities[0].agentId,actionName:'refund.create',arguments:body.arguments,environment:'development',requestedAt:new Date(),requestHash:'f'.repeat(64),policyDecision:'ALLOW',policyReason:'MATCHED_ALLOW',policyHash:'a'.repeat(64),policyEvaluatedAt:new Date()}});
  r=await send('POST',simPath,{...candidate,executionIds:[corrupt.id]},jwt[0]);assert.equal(r.json().results[0].skipped,'UNSUITABLE_HISTORY');
  // Expired evidence is hidden and swept without retaining input payloads.
  const old=await db.policyStudy.create({data:{organizationId:org,agentId:identities[0].agentId,mode:'OBSERVE',policyHash:'a'.repeat(64),summary:{},results:[{}],createdAt:new Date(Date.now()-31*86400000),expiresAt:new Date(Date.now()-86400000)}});
  assert.equal((await send('GET',studyPath+'/'+old.id,undefined,jwt[0])).statusCode,404);
  await send('POST','/v1/actions/observe',body);assert.equal(await db.policyStudy.findUnique({where:{id:old.id}}),null);
  const all=JSON.stringify(await db.policyStudy.findMany({where:scope}));assert.equal(all.includes('private_customer_payment'),false);assert.equal(all.includes(identities[0].apiKey),false);
  // Policy infrastructure errors do not become fabricated observation decisions.
  const engine=app.get(PolicyEngine),original=engine.evaluateDetailed;engine.evaluateDetailed=()=>{throw new Error('secret policy failure');};
  r=await send('POST','/v1/actions/observe',body);assert.equal(r.statusCode,503);assert.equal(r.body.includes('secret'),false);engine.evaluateDetailed=original;
 }finally{
  await db.$transaction([db.policyStudy.deleteMany({where:scope}),db.executionAttempt.deleteMany({where:scope}),db.approval.deleteMany({where:scope}),db.execution.deleteMany({where:scope}),db.agentCredential.deleteMany({where:scope}),db.agent.deleteMany({where:scope}),db.organizationMember.deleteMany({where:scope}),db.organization.deleteMany({where:{id:{in:[org,foreign]}}}),db.user.deleteMany({where:{id:{in:users}}})]);
  await app.close();
 }
});
