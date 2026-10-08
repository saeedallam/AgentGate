import { z } from 'zod';

const parsed = z.uuid().safeParse(process.argv[2]);
if (!parsed.success) {
  console.error('Usage: node scripts/print-demo-policy.mjs ORGANIZATION_UUID');
  process.exitCode = 1;
} else {
  const organizationId = parsed.data;
  const usd = { field: 'arguments.currency', operator: 'EQ', value: 'USD' };
  const amount = (operator, value) => ({ field: 'arguments.amountMinor', operator, value });
  const rule = (effect, conditions) => ({
    organizationId, actionName: 'refund.create', effect, conditions: [usd, ...conditions],
  });
  const rules = [
    rule('ALLOW', [amount('LTE', 5000)]),
    rule('REQUIRE_APPROVAL', [amount('GT', 5000), amount('LTE', 50000)]),
    rule('DENY', [amount('GT', 50000)]),
  ];
  // Print a dotenv assignment only; never modify .env or install grants implicitly.
  console.log(`POLICY_RULES_JSON='${JSON.stringify(rules)}'`);
}
