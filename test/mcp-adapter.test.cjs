const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createAgentGateMcpServer, parseMcpConfig } = require('../dist/mcp/server.js');
const key = 'agt_live_'+'a'.repeat(32)+'_'+'b'.repeat(64);
const env = { AGENTGATE_API_KEY: key, AGENTGATE_URL: 'http://127.0.0.1:3000' };

test('MCP config accepts only operator origins and never echoes credentials in errors', () => {
  assert.equal(parseMcpConfig(env).baseUrl, 'http://127.0.0.1:3000');
  assert.equal(parseMcpConfig({...env,AGENTGATE_URL:'https://agentgate.example.test'}).baseUrl,'https://agentgate.example.test');
  for (const origin of ['http://remote.example.test','file:///etc/passwd','https://user:secret@example.test','https://example.test/other','https://example.test/?key=secret']) {
    assert.throws(()=>parseMcpConfig({...env,AGENTGATE_URL:origin}),e=>!e.message.includes('secret') && e.message.startsWith('Invalid MCP configuration'));
  }
  assert.throws(()=>parseMcpConfig({...env,AGENTGATE_API_KEY:key+'\n'}));
});

test('real MCP protocol lists strict tools, routes via authenticated API and sanitizes transport failures', async () => {
  const calls=[]; let responseStatus=200, fail=false, responseBody={status:'SUCCEEDED'};
  const fakeFetch=async (url,options)=>{
    calls.push({url,options});
    if(fail) throw new Error('secret-provider-stack '+key);
    return new Response(JSON.stringify(responseBody),{status:responseStatus});
  };
  const server=createAgentGateMcpServer(env,fakeFetch), client=new Client({name:'test',version:'1.0.0'});
  const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);await client.connect(clientTransport);
    const list=await client.listTools();
    assert.deepEqual(list.tools.map(t=>t.name).sort(),['execution_get','execution_reconcile','execution_resume','execution_retry','refund_create','refund_observe']);
    assert.equal(list.tools.some(t=>t.name.includes('approve')),false);
    const args={paymentId:'p',amountMinor:1000,currency:'USD',idempotencyKey:'intent-1'};
    let result=await client.callTool({name:'refund_create',arguments:args});
    assert.equal(result.isError,undefined);assert.equal(calls.length,1);
    assert.equal(calls[0].url,env.AGENTGATE_URL+'/v1/actions');
    assert.equal(calls[0].options.headers.authorization,'Bearer '+key);
    assert.equal(calls[0].options.headers['idempotency-key'],'intent-1');
    assert.equal(calls[0].options.redirect,'error');
    assert.deepEqual(JSON.parse(calls[0].options.body),{action:{name:'refund.create'},arguments:{paymentId:'p',amountMinor:1000,currency:'USD'}});
    for (const bad of [{...args,organizationId:randomUUID()},{...args,policy:'ALLOW'},{...args,paymentId:'../secret'},{...args,amountMinor:'1000'}]) {
      const rejected=await client.callTool({name:'refund_create',arguments:bad});assert.equal(rejected.isError,true);
    }
    assert.equal(calls.length,1);
    const id=randomUUID();
    result=await client.callTool({name:'execution_resume',arguments:{executionId:id,arguments:{amountMinor:1}}});
    assert.equal(result.isError,true);assert.equal(calls.length,1);
    for(const operation of ['get','resume','retry','reconcile']) {
      await client.callTool({name:'execution_'+operation,arguments:{executionId:id}});
      const last=calls.at(-1); assert.equal(last.url,env.AGENTGATE_URL+'/v1/executions/'+id+(operation==='get'?'':'/'+operation));
      if(operation!=='get') assert.equal(last.options.body,'{}');
    }
    await client.callTool({name:'refund_observe',arguments:{paymentId:'p',amountMinor:1000,currency:'USD'}});
    assert.equal(calls.at(-1).url,env.AGENTGATE_URL+'/v1/actions/observe');
    responseStatus=403;responseBody={code:'POLICY_APPROVAL_REQUIRED',approvalId:id};
    result=await client.callTool({name:'refund_create',arguments:args});
    assert.equal(result.isError,true);assert.equal(result.structuredContent.result.approvalId,id);
    responseStatus=500;responseBody={message:'secret-provider-stack '+key};
    result=await client.callTool({name:'refund_create',arguments:args});
    assert.equal(result.structuredContent.code,'BACKEND_UNAVAILABLE');assert.equal(JSON.stringify(result).includes(key),false);
    fail=true;const before=calls.length;
    result=await client.callTool({name:'refund_create',arguments:args});
    assert.equal(calls.length,before+1);assert.equal(result.structuredContent.code,'TRANSPORT_UNCERTAIN');assert.equal(JSON.stringify(result).includes(key),false);
  } finally {await client.close();await server.close();}
});
