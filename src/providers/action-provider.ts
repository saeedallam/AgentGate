import type { ActionRequest } from '../actions/action-request.js';
import type { ExecutionOutcome } from '../executions/executions.service.js';

export type ConfirmedOutcome = Extract<ExecutionOutcome, { status: 'SUCCEEDED' }>
  | { status: 'FAILED'; errorCode: string };
export type ProviderLookup = { status: 'FOUND'; outcome: ConfirmedOutcome } | { status: 'NOT_FOUND' };

// execute must atomically bind a durable operation key to a payload and final
// outcome, returning the same outcome for concurrent/repeated identical calls.
// NOT_FOUND is observation only, NEVER proof that an earlier call cannot execute.
export interface ActionProvider {
  readonly recoveryVersion: 1;
  execute(operationKey: string, request: ActionRequest): Promise<ExecutionOutcome>;
  lookup(operationKey: string, request: ActionRequest): Promise<ProviderLookup>;
}
