import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z, ZodError } from 'zod';
import { PrismaService } from '../infrastructure/database/prisma.service.js';
import type { AuthenticatedAgent } from '../agent-credentials/agent-authentication.service.js';
import { ActionRequestFactory } from '../actions/action-request.factory.js';
import { ActionRegistry, UnknownActionError } from '../actions/action-registry.js';
import type { ActionEnvironment } from '../actions/action-request.js';
import { PolicyEngine } from '../policies/policy-engine.js';
import { PolicyStore } from '../policies/policy-store.js';
import { policySchema, policiesSchema } from '../policies/policy.js';
import { actionJson } from '../executions/action-json.js';
import { verifiedActionRequest } from '../executions/verified-action-request.js';
import { studyPolicyHash, summarizeDecisions } from './policy-study.js';
import type { Prisma } from '../generated/prisma/client.js';

const simulationSchema = z.strictObject({
  executionIds: z.array(z.uuid()).min(1).max(100).refine(ids => new Set(ids).size === ids.length),
  policies: z.array(policySchema.omit({ organizationId: true })).max(100),
});
const listSchema = z.strictObject({
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(100)).default(25),
  cursor: z.uuid().optional(),
});
const select = { id: true, mode: true, agentId: true, userId: true, policyHash: true, summary: true, createdAt: true, expiresAt: true } as const;

@Injectable()
export class ObservationsService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService,
    private readonly policies: PolicyStore, private readonly engine: PolicyEngine) {}

  async observe(identity: AuthenticatedAgent, input: unknown) {
    let request;
    try {
      request = new ActionRequestFactory(new ActionRegistry(), this.config.get<ActionEnvironment>('ACTION_ENVIRONMENT', 'development')).create(identity, input);
    } catch (error) {
      if (error instanceof ZodError || error instanceof UnknownActionError) throw new BadRequestException('Invalid observation request');
      throw error;
    }
    let rules, result;
    try {
      rules = this.policies.forOrganization(identity.organizationId);
      result = this.engine.evaluateDetailed(request, rules);
    } catch { throw new ServiceUnavailableException('Policy evaluation unavailable'); }
    const row = { actionName: request.action.name, requestHash: actionJson(request).hash, ...result };
    return this.persist({ organizationId: identity.organizationId, agentId: identity.agentId, mode: 'OBSERVE',
      policyHash: studyPolicyHash(rules), summary: summarizeDecisions([row]), results: [row] });
  }

  private async member(userId: string, organizationId: string, owner = false) {
    const membership = await this.prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { role: true } });
    if (!membership) throw new NotFoundException('Organization not found');
    if (owner && membership.role !== 'OWNER') throw new ForbiddenException('Owner role required');
  }

  async simulate(userId: string, organizationId: string, input: unknown) {
    await this.member(userId, organizationId, true);
    const parsed = simulationSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid simulation request');
    const { executionIds, policies } = parsed.data;
    const rules = policiesSchema.parse(policies.map(rule => ({ ...rule, organizationId })));
    const executions = await this.prisma.execution.findMany({ where: { organizationId, id: { in: executionIds } } });
    if (executions.length !== executionIds.length) throw new NotFoundException('One or more executions not found');
    const registry = new ActionRegistry();
    const results = executionIds.map(id => {
      const execution = executions.find(e => e.id === id)!;
      if (!execution.policyDecision || !execution.policyReason || !execution.policyHash || !execution.policyEvaluatedAt) return { executionId: id, skipped: 'MISSING_POLICY_EVIDENCE' };
      let request;
      try {
        request = verifiedActionRequest(execution, execution.requestHash ?? '');
        const supported = registry.parse(request.action.name, request.arguments);
        if (actionJson({ ...request, ...supported }).hash !== execution.requestHash) throw new ConflictException();
      } catch (error) {
        if (error instanceof ConflictException || error instanceof ZodError || error instanceof UnknownActionError) return { executionId: id, skipped: 'UNSUITABLE_HISTORY' };
        throw error;
      }
      const result = this.engine.evaluateDetailed(request, rules);
      return { executionId: id, actionName: execution.actionName, requestHash: execution.requestHash!,
        recordedDecision: execution.policyDecision, recordedPolicyHash: execution.policyHash, ...result };
    });
    return this.persist({ organizationId, userId, mode: 'SIMULATE', policyHash: studyPolicyHash(rules),
      summary: summarizeDecisions(results), results });
  }

  private async persist(data: Pick<Prisma.PolicyStudyUncheckedCreateInput, 'organizationId' | 'agentId' | 'userId' | 'mode' | 'policyHash' | 'summary' | 'results'>) {
    const now = new Date();
    const study = await this.prisma.$transaction(async tx => {
      // Bounded per-tenant expiry sweep; the operator cleanup script handles idle tenants.
      const expired = await tx.policyStudy.findMany({ where: { organizationId: data.organizationId, expiresAt: { lte: now } }, select: { id: true }, take: 100 });
      if (expired.length) await tx.policyStudy.deleteMany({ where: { organizationId: data.organizationId, id: { in: expired.map(r => r.id) } } });
      return tx.policyStudy.create({ data: { ...data, createdAt: now, expiresAt: new Date(now.getTime() + 30 * 86400000) }, select: { ...select, results: true } });
    });
    return { ...study, policyOnly: true, executed: false, authorizationGranted: false,
      excludedChecks: ['budget', 'approval', 'provider-resource', 'execution-time-credentials'] };
  }

  async list(userId: string, organizationId: string, input: unknown) {
    await this.member(userId, organizationId);
    const parsed = listSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid observation query');
    const { limit, cursor } = parsed.data;
    const where = { organizationId, expiresAt: { gt: new Date() } };
    if (cursor && !await this.prisma.policyStudy.findFirst({ where: { ...where, id: cursor }, select: { id: true } })) throw new NotFoundException('Observation cursor not found');
    const rows = await this.prisma.policyStudy.findMany({ where, select, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
  }

  async get(userId: string, organizationId: string, id: string) {
    await this.member(userId, organizationId);
    const study = await this.prisma.policyStudy.findFirst({ where: { id, organizationId, expiresAt: { gt: new Date() } }, select: { ...select, results: true } });
    if (!study) throw new NotFoundException('Observation not found');
    return { ...study, policyOnly: true, executed: false, authorizationGranted: false };
  }
}
