import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ActionRequest } from '../actions/action-request.js';

// Reject non-JSON values rather than silently dropping/converting them.
export function actionJson(request: ActionRequest) {
  const args = z.record(z.string(), z.json()).parse(request.arguments);
  const canonical = (value: z.infer<ReturnType<typeof z.json>>): string => {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value !== null && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(key =>
        JSON.stringify(key) + ':' + canonical(value[key]!)
      ).join(',') + '}';
    }
    return JSON.stringify(value);
  };
  // Receipt time is intentionally excluded so retries match.
  const hash = createHash('sha256').update(canonical({
    version: 1, organizationId: request.organizationId,
    agentId: request.principal.id, action: request.action.name,
    resource: request.resource ? { ...request.resource } : null,
    environment: request.context.environment, arguments: args,
  })).digest('hex');
  return { args, hash };
}
