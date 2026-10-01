import type { ActionResource } from './action-request.js';
import { parseRefundCreateArguments } from './definitions/refund-create.action.js';

export interface ParsedAction {
  readonly action: {
    readonly name: string;
  };

  readonly resource?: ActionResource;

  readonly arguments: Readonly<Record<string, unknown>>;
}

type ActionParser = (input: unknown) => ParsedAction;

export class UnknownActionError extends Error {
  constructor() {
    super('Unknown action');
    this.name = 'UnknownActionError';
  }
}

const actionParsers: ReadonlyMap<string, ActionParser> = new Map([
  [
    'refund.create',
    (input: unknown): ParsedAction => {
      const args = parseRefundCreateArguments(input);

      return {
        action: {
          name: 'refund.create',
        },
        resource: {
          type: 'payment',
          id: args.paymentId,
        },
        arguments: args,
      };
    },
  ],
]);

export class ActionRegistry {
  parse(actionName: string, input: unknown): ParsedAction {
    const parser = actionParsers.get(actionName);

    if (!parser) {
      throw new UnknownActionError();
    }

    return parser(input);
  }
}
