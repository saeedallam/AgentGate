import { InvalidPolicyConfigurationError } from './policy-engine.js';
import { policiesSchema } from './policy.js';
import type { Policy } from './policy.js';

// Server-owned startup snapshot. Never populate this from request bodies.
export class PolicyStore {
  private readonly byOrganization = new Map<string, Policy[]>();

  constructor(raw: string = '[]') {
    let input: unknown;
    try {
      if (typeof raw !== 'string' || raw.length > 262144) {
        throw new InvalidPolicyConfigurationError();
      }
      input = JSON.parse(raw);
    } catch {
      throw new InvalidPolicyConfigurationError();
    }
    const parsed = policiesSchema.safeParse(input);
    if (!parsed.success) throw new InvalidPolicyConfigurationError();

    for (const policy of parsed.data) {
      const rules = this.byOrganization.get(policy.organizationId) ?? [];
      rules.push(policy);
      this.byOrganization.set(policy.organizationId, rules);
    }
  }

  forOrganization(organizationId: string): Policy[] {
    return structuredClone(this.byOrganization.get(organizationId) ?? []);
  }
}
