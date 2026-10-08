# Learning notes

## 2026-10-06 — Policies and the first automated test

Learner's own words:

- Tenant isolation: «عشان ممكن نحط في الbody عميل من مؤسسه و احنا من مؤسسه تانيخ»
- Unknown outcomes and retries: «عشان لو نجح ومكنش فيه رد لو عملنا بمفتاح جديد يبقي هنكرر الاثر»
- Decision with no policies, after correction: «deny».
- Test expecting DENY but receiving ALLOW: «يفشل بالتاكيد».

Still to explain in the learner's own words: what an automated test does and why
default denial differs from requiring approval. Do not treat the short answers
above as complete definitions.

## 2026-10-07 — Conditional allowance

- Why unconditional ALLOW is wrong, in the learner's words:
  «هيسمح للكل بالشكل دا لان المفروض يترفض تلقائي».

- `some`, in the learner's words: «هل في حاجه واحده علي الاقل تحقق الشرط».
- `every`, in the learner's words: «هل الكل يحقق الشرط».
- Deny precedence, in the learner's words: «نفحص قواعد المنع الاول».

Implementation scope: four tests cover default denial with an empty policy list,
allowance at a configured USD refund limit, and matching DENY overriding ALLOW
in both policy orders, and REQUIRE_APPROVAL overriding ALLOW in both orders.
The engine supports tenant/action-scoped ALLOW, DENY and REQUIRE_APPROVAL
rules with EQ and LTE conditions on direct argument fields. All conditions must
match before a rule participates in the decision. It is not connected to HTTP.
Policy input validation and further negative-case/precedence tests are still
pending; this is not a complete policy engine or an approval workflow.

- Approval precedence, in the learner's words:
  «اظن الاوليه تروح ل`REQUIRE_APPROVAL`» when ALLOW and REQUIRE_APPROVAL match.
  When asked where its check belongs relative to DENY and ALLOW: «بينهم».

## 2026-10-08 — Matching before precedence

Learner's own explanation of excluding a nonmatching deny rule:
«لانه طلب استرداد 50 دولار و قاعدة المنع شرطها المبلغ أكبر من 500 دولار فكده لم تحقق شرط الطلب».

Added tests: DENY wins over matching ALLOW and REQUIRE_APPROVAL in all six
orders; a EUR-only DENY does not override a matching USD ALLOW in either order.
These exercise existing behavior; no engine changes were needed. The greater-than
example was conceptual: implemented operators remain EQ and LTE.

### Boundary and organization-isolation exercises

- Learner supplied the boundary-table row `[4900, 'ALLOW']`; included in the test.
- Why matching action and amount alone cannot authorize across organizations,
  in the learner's words: «لاختلاف المؤسسات».
- Added a test that first verifies an own-organization rule allows the request,
  then changes only the rule organization and verifies DENY.

## 2026-10-08 — Phase C, part 1 of 4

Implemented strict runtime policy validation before any decision, with a generic
InvalidPolicyConfigurationError (no policy contents in the message). Added EQ,
NEQ, GT, GTE, LT, LTE, IN, NOT_IN and EXISTS. Supported fields are direct own
argument keys, principal.id, resource.type/id and context.environment.
Missing fields fail ordinary comparisons including NEQ/NOT_IN; EXISTS checks
undefined vs present (null is present). No numeric string coercion. Conditions
are ANDed; an empty conditions list intentionally matches any validated request
within the rule's exact organization and action.

The USD 50/500 bands are test fixtures only, not installed runtime rules. Schema
bounds: 1000 rules, 32 conditions per rule, 100 IN/NOT_IN values. Nested argument
paths are not supported. Policies are trusted server configuration, never client
permissions; choosing their source and HTTP integration remain parts 2 and 3.

Four new tests first failed against the previous engine, then passed after the
implementation. Total policy tests: 12. No new learner definitions are attributed
here; these are implementation notes. Database integration was not exercised in
this pure-engine slice.

## 2026-10-08 — Phase C, part 2 of 4

Implementation notes (not learner-authored definitions): POLICY_RULES_JSON is a
server-only startup snapshot. PolicyStore validates the full configuration before
indexing rules by organization. Its reads return deep copies. PoliciesModule is
registered in AppModule, so invalid rules prevent normal startup; action dispatch
integration is still pending. Three store tests cover tenant selection/default
empty rules, invalid configuration with redacted errors, and nested mutation
isolation. See phase-c-guide.md for operational tradeoffs and configuration format.

## 2026-10-08 — Phase C, part 3 of 4

Implementation notes: ActionsService evaluates policies after receive and before
claim for RECEIVED executions. Existing dispatches replay recorded state. DENY
and REQUIRE_APPROVAL return distinct 403 codes with executionId and create no
attempt; policy infrastructure errors return generic 503. Blocked receipts remain
RECEIVED, with no persisted decision/approval record. Retrying after a server
policy update reevaluates them. Six service tests cover gating, successful/lost
claims, replay, failures, tenant grants/spoofing and idempotency conflicts.
All 59 ordinary tests plus build/lint passed locally. Database integration has
not been rerun in this slice. HTTP/database verification is part 4.

## 2026-10-08 — Phase C, part 4 of 4

Delivery notes: 61 ordinary tests, build and lint passed. Two database integration
suites passed on an embedded single-connection lab; native PostgreSQL concurrency
verification is pending. Added a no-secret Postman collection and an explicit
print-only demo-policy generator. See phase-c-guide.md. The learner requested four
substantial parts instead of per-line questions; do not resume repetitive quizzes.
