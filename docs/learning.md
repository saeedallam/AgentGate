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


## 2026-10-11 — Original decisions and transactions

Learner's own explanations:
- Missing historical decision: «المفروض ان احنا منقدرش نجزم قراره الاصلي».
- Transaction: «وجود الحاجات دي في tx يا ينجحوا كلهم يا يحصل rollback».

Phase C correction saves the request and original policy decision together.
Legacy pending rows without decision evidence stop for review. Saved denial or
approval requirement cannot be upgraded by same-key replay after policy changes.
Approval workflow work remains separate in Phase D.


## 2026-10-09 — Phase D: approval state

Updated teaching preference: pause for important security concepts and explain
tests from first principles; the four-message limit is no longer a constraint.

Learner's own words:
- Approval vs execution outcome: «الحاله هتبقي `APPROVED` و التنفيذ هيتسجل `FAILED`».
  Clarification discussed: an unconfirmed effect uses OUTCOME_UNKNOWN instead.
- Purpose of the rejected-to-approved test: «ان الكود يمنعه».
- Tenant authorization: «لا لانه مش من المؤسسه نفسها فعزل المؤسسات واجب».

First local slice: transitionApproval permits only PENDING to APPROVED/REJECTED.
It throws InvalidApprovalTransitionError for forbidden transitions. The first
test covers REJECTED to APPROVED only; other transitions still need test coverage.
No approval database model, endpoints or concurrent decision protection yet.
This pure function does not write state or execute an action.

## 2026-10-10 — Function result versus test result

The learner initially answered «SUCCESS» for the result of PENDING to REJECTED.
We clarified that the function returns the new approval state, while the test
passes when that state matches its expectation. For PENDING to APPROVED, the
learner then answered «`APPROVED`». A full independent definition is still pending.

Added tests for both permitted transitions and the remaining six forbidden pairs.
Together with the original REJECTED-to-APPROVED test, all nine pairs among the
three states are covered. Error checks also verify the attempted from/to states.
This supersedes the earlier one-test coverage note; no database integration yet.

## 2026-10-11 — Approval persistence constraints

Learner's tenant-link explanation: «لازم قاعدة البيانات تتأكد إنه موجود في نفس `organizationId` كمان».
Added Approval with a unique executionId and a composite organization/execution
foreign key. Prisma's one-to-one relation additionally requires composite uniqueness.
The optional decidedBy user foreign key preserves user existence, not OWNER authorization.
State, actor and timestamp consistency, payload immutability/hash verification and
concurrent decision writes still need service/database safeguards in later slices.
The requestHash column alone does not enforce fingerprint correctness.

Generated migration 20261010213000_add_approvals via schema diff. Prisma format,
validation, generation, build and scoped lint passed. The approval-model integration
test passed on a fresh PGlite database after the full migration chain, with a temporary
compiled-only pool limit of 1 restored afterwards. Native PostgreSQL remains to verify.
These Phase D changes are local and not connected to HTTP or pushed yet.

## 2026-10-11 — Decision authorization service

Learner's explanation: «لو بعت في الbody نرفضه بالتاكيد نقرا عضويته من المحفوظ في قاعدة البيانات لان ممكن member يبعت انه owner».
Implemented a local ApprovalsService.decide with strict decision input, membership
lookup using the approval organization and authenticated user, OWNER requirement,
and a conditional PENDING update recording status/actor/time together. Serializable
transaction conflicts become 409; unrelated errors propagate. No HTTP wiring yet.
The MEMBER test passed with zero attempted writes and unchanged PENDING state;
three state tests, build and scoped lint passed. OWNER success, spoof rejection,
foreign users and concurrent database decisions still require further tests. The
fake transaction in this unit test does not establish real database isolation.

Decision-service test follow-up: outsider requests receive identical 404 messages
for PENDING, APPROVED and REJECTED, with zero updates. OWNER success is covered
for both decisions, including the scoped PENDING update, trusted actor and server
time. All three service tests and scoped lint passed; no service changes needed.
These use transaction doubles and do not verify real database concurrency.

## 2026-10-11 — Transaction failure classification

The learner distinguished update attempts from successful writes («بتعدّ محاولات التحديث»)
and recognized that expecting 409 but receiving 403 fails the test («كده فشل»).
Added tests for P2034 becoming a generic 409 with one transaction attempt, and
other database/infrastructure errors propagating as the same error object.
All six service unit tests and scoped lint passed without service changes.
These tests do not establish actual database races or HTTP error redaction.

## 2026-10-11 — Preserve the original policy decision

Learner's explanation of a legacy receipt: «المفروض ان احنا منقدرش نجزم قراره الاصلي».
Therefore legacy RECEIVED rows with missing decision evidence stop for review;
we do not reconstruct historical permission from today's policy.

Implemented initial decision/reason/time/policy hash persistence and atomic pending
approval creation. Same-key replay preserves saved denial/approval; current rules
may restrict an old allowance. A lost insert race reads the winner and verifies the
payload fingerprint. New terminology (snapshot and atomic receipt) still awaits
the learner's own definition; no understanding is inferred from silence.


## Release boundary — 2026-10-11

Phase C-only decision persistence was published as 496da4463a59fce54a899199b005c91400667ae3. Source: ../phase-c-release. Phase D approval files remain local here. The published migration 20261011010000_persist_policy_decisions is identical in both directories. Preserve published changes when resuming D; do not push this entire directory without rebasing/review. The user will clarify the Phase D stopping point.

## 2026-10-11 — Database immutability, local Phase D slice

The learner initially believed readonly prevents SQL writes, then initially chose
to freeze execution status as well. We clarified that TypeScript readonly does
not create a database constraint, and request identity/payload must remain fixed
while permitted progress and outcome updates remain possible. The learner agreed
(«مظبوط»); a definition in their own words is still pending.

Added execution-immutability.integration.cjs and observed it fail because changing
the amount succeeded. Added migration 20261011100000_freeze_execution_request with
a BEFORE UPDATE trigger comparing original request and initial policy evidence.
The regression passes, including direct SQL mutation rejection and normal progress
and result updates. IS DISTINCT FROM handles NULLs; the trigger does not validate
lifecycle transitions, initial fingerprint correctness, DELETEs, or privileged
administrators disabling triggers. Existing service checks remain required.

This is local Phase D work, not published. The previously added failing unit test
for fingerprint verification in ApprovalsService remains unfinished; this database
trigger does not implement that application check. Approval binding immutability,
HTTP workflow and resume remain pending.

## 2026-10-12 — Verify the stored action before a human decision

Learner identified that a rejected outcome write is a recording failure:
«تسجيل الحالة». The provider effect must not be repeated because of that failure.

Added verifiedActionRequest to reconstruct a request from stored fields and compare
its freshly computed fingerprint with both the execution and approval hashes.
ApprovalsService reads the tenant-scoped execution after OWNER authorization,
requires RECEIVED plus REQUIRE_APPROVAL, and verifies before the conditional
PENDING update. Invalid evidence returns 409 without attempted writes; database
read failures are not converted into integrity errors. No caller-supplied action
payload is used. The same helper can later be used before approved dispatch.

The previously red changed-payload regression now passes. Grouped tests cover
missing/wrong hashes, resource changes/partial resources, malformed arguments,
environment changes, wrong execution state and both human decisions. All 80
ordinary tests and lint passed locally. Approval HTTP endpoints, dispatch wiring,
approval-binding immutability and database decision/concurrency integration remain
unfinished. These Phase D changes have not been published.

## 2026-10-12 — Monitoring without exposing action details

Learner's requested scope: «ممكن ال member الاطلاع من اجل المراقبه مع عزل الاموار اللي ممكن تكون حساسه مثلا كخدمة عملاء ع سبيل مثال».
The learner accepted summary-only monitoring («لا كده كفاية»), without amount or
currency. MEMBER can read approval/execution IDs, statuses, action name and dates;
OWNER can additionally inspect the verified stored action and decide. Responses
are allowlisted on the server, not merely hidden by the UI. List reads select only
summary fields; sensitive action details are fetched only after OWNER membership.

Implemented list/detail/decision JWT routes and module wiring. Observed the initial
HTTP regression fail (404 instead of 200) before routes existed, then pass. All 81
ordinary tests and lint passed; the stored-membership HTTP database test passed
on PGlite with a compiled-only pool cap. No native database race claim. This slice
does not start an execution when the OWNER approves. Phase D remains local.

## 2026-10-12 — Phase D batch 1: binding and resume

Learner selected batch 1 («1») after asking to speed up work and group repetitive
tests. No new claim of learner understanding is inferred from this implementation.

Added explicit agent-authenticated POST /v1/executions/:id/resume, reconstructing
only stored action data, checking fingerprints/approval/current rules/environment,
and dispatching only after the conditional claim. Human approval remains a separate
JWT operation. Claim checks exact approval identity/hash/status, active agent and
nonrevoked credential in the update that starts execution. Added database binding
and final decision immutability plus metadata constraints.

Observed the missing resume test fail before implementation and the approval-binding
mutation test fail before its migration. After implementation: 87 ordinary tests,
lint and eight embedded-database integration suites passed. One integration journey
covers duplicate HTTP resumes, stored payload, current deny, rejected approval,
unknown effect replay and revocation between authentication and claim. These do not
replace native multi-connection PostgreSQL concurrency verification, which belongs
to batch 2 along with final review, publication and Postman walkthrough.

## 2026-10-12 — Phase D batch 2

Learner asked to continue batch 2. No new learner definition is inferred.
Implementation groups repeated database tests and prepares the Postman journey.
Terms for the next review (teacher definitions, not yet explained by the learner):
- Independent connection: a separate PostgreSQL backend session, verified by its PID.
- Barrier: a test rendezvous that holds both transactions immediately before writes.
- CI: automated build/tests on the repository; its recorded result is evidence,
  while merely adding its configuration is not.

The earlier explanation remains central: «وجود الحاجات دي في tx يا ينجحوا كلهم يا يحصل rollback».
The learner will explain the approved-request journey after running the walkthrough.

Batch 2 result: native PostgreSQL 17 verification succeeded in GitHub Actions run
38282172521, including independent-connection receipt/decision/claim races.
The implementation is published; learner walkthrough and explanation remain to do.

## 2026-10-12 — Policy tightening review

Learner explicitly agreed that a request permanently denied after tightening must
stay denied under the same key even if rules later return to ALLOW («اه نفذ اللي انت
شايفه صح و اعرضه عليا بالاكواد»). No additional learner definitions are inferred.
Teacher explanation: initial policy evidence records the original decision; DENIED
and blockedPolicy* record a later terminal veto. Claim and denial compete on the
same RECEIVED row. See policy-tightening.md for implementation and boundaries.


## Phase E — implementation notes, learner definitions pending

These are instructor explanations, not attributed learner definitions. The learner
requested implementation followed by a detailed code walkthrough; no new answers
have yet been supplied for this phase.

- Reconciliation: ask the provider for evidence about an existing operation; no dispatch.
- Stable operation key: same execution ID across all attempts.
- Lease: bounded claim interval; expiry does not prove the old worker stopped.
- Fencing: only the current attempt can complete the execution.
- Backoff: wait before another permitted dispatch; three attempts maximum here.
- Durable receipt: provider-owned result committed atomically with the fake effect.

Exercise to answer in the learner's own words: why is NOT_FOUND insufficient to
prove absence, and why must a retry preserve the provider operation key?

## Phase F — prepared for joint E/F lesson (2026-10-15)

Implementation completed before teaching at the learner's request. The following
are instructor definitions, not claims about the learner's current understanding:

- Reservation: capacity held for one admitted execution, including unknown results.
- Consumption: reserved money confirmed as successfully refunded.
- Release: capacity returned only after a definite no-effect failure.
- Daily bucket: shared organization/environment/USD balance for first-dispatch UTC day.
- Atomic admission: execution claim, attempt and reservation commit or roll back together.

Learner wording and comprehension evaluation remain pending the joint E/F lesson.

## G/H — implementation-first request (2026-10-15)

The learner asked to finish the remaining original roadmap and explain the whole
project afterward. The joint E/F lesson was paused at atomic claim/reservation.
No new G/H definitions have yet been supplied by the learner.

Instructor notes for the later lesson:
- Observation: a recorded policy-only would-decision, with no external execution.
- Historical simulation: candidate rules evaluated on verified stored requests;
  it does not install rules or reproduce budgets/approvals/provider state.
- Adapter: a transport translation that preserves the backend's security boundary.
- MCP stdio: JSON-RPC over a host-launched process's stdin/stdout; stdout is not logs.
- Transport uncertainty: no trusted response is not proof that no effect occurred.

Learner wording, examples, exercises and comprehension checks remain pending.
