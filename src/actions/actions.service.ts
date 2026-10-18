import {
  assertSnapshot,
  assertNotDenied,
  assertRecoveryInput,
} from "./action-preconditions.js";
import { assertUnexpired } from "../executions/execution-deadline.js";
import { evaluatePolicy } from "../policies/evaluate-policy.js";
import { requireApprovalBinding } from "./approval-gate.js";
import type { ExecutionReader } from "../executions/execution-reader.js";
import type { Execution } from "../generated/prisma/client.js";
import { BLOCK_CODE } from "./action-block-code.js";
import { blocked } from "./action-block.js";
import { randomUUID } from "node:crypto";
import { PolicyStore } from "../policies/policy-store.js";
import { PolicyEngine } from "../policies/policy-engine.js";
import { retryWindow } from "../executions/recovery-contract.js";
import type { ActionProvider } from "../providers/action-provider.js";
import {
  Inject,
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z, ZodError } from "zod";
import type { AuthenticatedAgent } from "../agent-credentials/agent-authentication.service.js";
import {
  ExecutionsService,
  type ExecutionOutcome,
} from "../executions/executions.service.js";
import { FakeCommerceProvider } from "../fake-commerce/fake-commerce.provider.js";
import { ActionRegistry, UnknownActionError } from "./action-registry.js";
import { ActionRequestFactory } from "./action-request.factory.js";
import { verifiedActionRequest } from "../executions/verified-action-request.js";
import { actionJson } from "../executions/action-json.js";
import type { ActionRequest } from "./action-request.js";
import type { ActionEnvironment } from "./action-request.js";

@Injectable()
export class ActionsService {
  constructor(
    private readonly executions: ExecutionsService,
    @Inject(FakeCommerceProvider) private readonly provider: ActionProvider,
    private readonly config: ConfigService,
    private readonly policies: PolicyStore,
    private readonly policyEngine: PolicyEngine,
    private readonly registry: ActionRegistry = new ActionRegistry(),
  ) {}

  async submit(identity: AuthenticatedAgent, input: unknown, key: unknown) {
    this.assertExecutionEnabled();
    const keyResult = z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$(?![\s\S])/)
      .safeParse(key);
    if (!keyResult.success)
      throw new BadRequestException("Valid Idempotency-Key required");
    const factory = new ActionRequestFactory(
      this.registry,
      this.config.get<ActionEnvironment>("ACTION_ENVIRONMENT", "development"),
    );
    let request;
    try {
      request = factory.create(identity, input);
    } catch (error) {
      if (error instanceof ZodError || error instanceof UnknownActionError) {
        throw new BadRequestException("Invalid action request");
      }
      throw error;
    }
    const evaluate = () =>
      evaluatePolicy(request, this.policies, this.policyEngine);
    const execution = await this.executions.receive(
      request,
      keyResult.data,
      evaluate,
    );
    // Replays report recorded outcomes; they never authorize a fresh dispatch.
    assertNotDenied(execution);
    assertUnexpired(execution);
    if (execution.status !== "RECEIVED")
      return this.readExecution(identity, execution.id);
    const savedDecision = assertSnapshot(execution);
    // Current rules may restrict an old allowance, but cannot upgrade a saved denial.
    const current = execution.policyDecision === "ALLOW" ? evaluate() : null;
    if (current && current.policyDecision !== "ALLOW") {
      return this.denyTightened(identity, execution.id, {
        ...current,
        policyDecision: current.policyDecision,
      });
    }
    const decision = savedDecision;
    if (decision !== "ALLOW") {
      throw blocked(
        execution.approval?.status === "APPROVED"
          ? BLOCK_CODE.APPROVAL_READY_TO_RESUME
          : decision === "REQUIRE_APPROVAL"
            ? BLOCK_CODE.POLICY_APPROVAL_REQUIRED
            : BLOCK_CODE.POLICY_DENIED,
        execution.approval?.status === "APPROVED"
          ? "Approval granted; resume the stored execution"
          : decision === "REQUIRE_APPROVAL"
            ? "Action requires approval"
            : "Action denied by policy",
        {
          decision,
          executionId: execution.id,
          approvalId: execution.approval?.id ?? null,
          approvalStatus: execution.approval?.status ?? null,
        },
      );
    }
    const attemptId = randomUUID();
    if (
      !(await this.executions.claim(
        identity,
        execution.id,
        undefined,
        attemptId,
      ))
    )
      return this.readExecution(identity, execution.id);
    return this.dispatch(identity, execution.id, request, attemptId);
  }

  async resume(identity: AuthenticatedAgent, id: string, input: unknown) {
    return this.startStored(identity, id, input, "resume");
  }

  async retry(identity: AuthenticatedAgent, id: string, input: unknown) {
    return this.startStored(identity, id, input, "retry");
  }

  async reconcile(identity: ExecutionReader, id: string, input: unknown) {
    this.assertExecutionEnabled();
    assertRecoveryInput(id, input);
    const execution = await this.executions.getStored(identity, id);
    if (!["EXECUTING", "OUTCOME_UNKNOWN"].includes(execution.status))
      return this.executions.get(identity, id);
    this.assertRecoveryContract(execution);
    const request = verifiedActionRequest(
      execution,
      execution.approval?.requestHash ?? execution.requestHash ?? "",
    );
    if (
      request.context.environment !==
      this.config.get("ACTION_ENVIRONMENT", "development")
    )
      throw new ConflictException(
        "Stored action belongs to a different environment",
      );
    // Observation is permitted even when current policy denies further dispatch.
    const observed = await this.provider.lookup(id, request);
    if (observed.status === "FOUND")
      return this.executions.reconcile(identity, id, observed.outcome);
    return {
      ...(await this.executions.expireLease(identity, id)),
      reconciliation: { status: "NOT_FOUND", retrySafeFromAbsence: false },
    };
  }

  private assertRecoveryContract(
    execution: Pick<Execution, "recoveryVersion">,
  ) {
    if (
      execution.recoveryVersion !== 1 ||
      this.provider.recoveryVersion !== 1
    ) {
      throw new ConflictException({
        statusCode: 409,
        error: "Conflict",
        code: "LEGACY_RECOVERY_UNSUPPORTED",
        message: "Durable provider recovery contract is unavailable",
      });
    }
  }

  private async startStored(
    identity: AuthenticatedAgent,
    id: string,
    input: unknown,
    mode: "resume" | "retry",
  ) {
    const retry = mode === "retry";
    this.assertExecutionEnabled();
    if (
      !z.uuid().safeParse(id).success ||
      !z.strictObject({}).safeParse(input === undefined ? {} : input).success
    ) {
      throw new BadRequestException(
        "Resume accepts an execution id and no action payload",
      );
    }
    const execution = await this.executions.getStored(identity, id);
    assertNotDenied(execution);
    assertUnexpired(execution);
    if (!retry && execution.status !== "RECEIVED")
      return this.readExecution(identity, id);
    if (retry) {
      if (["SUCCEEDED", "FAILED"].includes(execution.status))
        return this.readExecution(identity, id);
      this.assertRecoveryContract(execution);
      const storedRequest = verifiedActionRequest(
        execution,
        execution.approval?.requestHash ?? execution.requestHash ?? "",
      );
      if (
        storedRequest.context.environment !==
        this.config.get("ACTION_ENVIRONMENT", "development")
      )
        throw new ConflictException(
          "Stored action belongs to a different environment",
        );
      const observed = await this.provider.lookup(id, storedRequest);
      if (observed.status === "FOUND")
        return this.executions.reconcile(identity, id, observed.outcome);
      const reason = retryWindow(execution, new Date());
      if (reason)
        throw new ConflictException({
          statusCode: 409,
          error: "Conflict",
          code: reason,
          message: "Execution cannot be retried now",
        });
    }
    assertSnapshot(execution);
    if (execution.policyDecision === "DENY") {
      throw blocked(BLOCK_CODE.POLICY_DENIED, "Action denied by policy", {
        executionId: id,
      });
    }
    const binding = requireApprovalBinding(execution);
    const request = verifiedActionRequest(
      execution,
      binding?.requestHash ?? execution.requestHash ?? "",
    );
    if (
      request.context.environment !==
      this.config.get<ActionEnvironment>("ACTION_ENVIRONMENT", "development")
    ) {
      throw new ConflictException(
        "Stored action belongs to a different environment",
      );
    }
    // A valid historical hash must also describe an action supported by today's registry.
    try {
      const parsed = this.registry.parse(
        request.action.name,
        request.arguments,
      );
      if (actionJson({ ...request, ...parsed }).hash !== execution.requestHash)
        throw new ConflictException("Stored action definition changed");
    } catch (error) {
      if (error instanceof ZodError || error instanceof UnknownActionError)
        throw new ConflictException("Stored action is no longer supported");
      throw error;
    }
    const current = evaluatePolicy(request, this.policies, this.policyEngine);
    const decision = current.policyDecision;
    if (
      !retry &&
      execution.policyDecision === "ALLOW" &&
      decision !== "ALLOW"
    ) {
      return this.denyTightened(identity, id, {
        ...current,
        policyDecision: decision,
      });
    }
    if (decision === "DENY" || (decision === "REQUIRE_APPROVAL" && !binding)) {
      throw blocked(
        decision === "DENY"
          ? BLOCK_CODE.POLICY_DENIED
          : BLOCK_CODE.POLICY_APPROVAL_REQUIRED,
        decision === "DENY"
          ? "Action denied by current policy"
          : "Current policy requires approval",
        { decision, executionId: id },
      );
    }
    const attemptId = randomUUID();
    const claimed = retry
      ? await this.executions.claimRetry(
          identity,
          id,
          execution.attemptCount,
          attemptId,
          binding,
        )
      : await this.executions.claim(identity, id, binding, attemptId);
    if (!claimed) return this.readExecution(identity, id);
    return this.dispatch(identity, id, request, attemptId);
  }

  private async readExecution(identity: AuthenticatedAgent, id: string) {
    const execution = await this.executions.get(identity, id);
    assertNotDenied(execution);
    assertUnexpired(execution);
    return execution;
  }

  private async denyTightened(
    identity: AuthenticatedAgent,
    id: string,
    evidence: Parameters<ExecutionsService["denyForPolicyTightening"]>[2],
  ) {
    const execution = await this.executions.denyForPolicyTightening(
      identity,
      id,
      evidence,
    );
    assertNotDenied(execution);
    assertUnexpired(execution);
    // Claim may have won before the denial write: return its actual state.
    return execution;
  }

  private assertExecutionEnabled() {
    if (
      this.config.get("FAKE_EXECUTION_ENABLED") !== true ||
      this.config.get("NODE_ENV") === "production" ||
      this.config.get("ACTION_ENVIRONMENT") === "production"
    ) {
      throw new ServiceUnavailableException("Fake execution is disabled");
    }
  }

  private async dispatch(
    identity: AuthenticatedAgent,
    id: string,
    request: ActionRequest,
    attemptId: string,
  ) {
    let outcome: ExecutionOutcome;
    try {
      outcome = await this.provider.execute(id, request);
    } catch {
      // A thrown error never proves that a side effect did not happen.
      outcome = {
        status: "OUTCOME_UNKNOWN",
        errorCode: "PROVIDER_OUTCOME_UNKNOWN",
      };
    }
    // Persistence failures propagate as server errors. Never dispatch again.
    return this.executions.finish(identity, id, outcome, attemptId);
  }
}
