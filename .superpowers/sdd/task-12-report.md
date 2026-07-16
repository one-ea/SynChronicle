# Task 12 Report

## Status

Implemented platform model quotas, append-only accounting, administrator controls, user concurrency settings, usage reporting, and dynamic Scheduler limits.

## Quota Ledger

- Added append-only credit, reserve, settle, and release entries with unique `runId:modelCallId:operation` idempotency keys.
- User-scoped PostgreSQL advisory transaction locks serialize balance reads and writes, preventing concurrent reservations from overspending one balance.
- Reserve enforces known platform pricing, available balance, and remaining user budget before the Provider call.
- Settle records actual token usage and cost once, returns unused reservation value, and permits explicit debt visibility when actual Provider usage exceeds the estimate.
- Provider failure releases reservations. Worker startup reconciles stale reservations left by crashes.
- Platform model calls are wrapped at the AI SDK model boundary. Generate calls settle returned usage; streaming calls settle the finish usage event.

## Administration And Settings

- Added admin-only platform model create/update/disable and pricing APIs with strict Zod validation.
- Added audited balance adjustment and dynamic platform concurrency APIs.
- Added user settings and usage APIs for self-service concurrency bounded by the current administrator maximum.
- Usage responses aggregate settled cost and tokens per Agent and model.
- Platform credential references stay server-side; API responses expose the credential source only.
- Settings displays encrypted user credential sources and requires confirmation before revocation.
- Admin model disabling requires confirmation.

## Scheduler

- Scheduler reads the platform concurrency setting on each claim transaction while retaining explicit overrides for isolated tests.
- User concurrency remains read dynamically from the user row on each eligibility query.
- Lowering the platform maximum clamps users whose configured concurrency exceeds the new cap.

## Database

- Added user budget, platform settings, quota operation, model call, idempotency, reservation, and metadata fields.
- Generated `drizzle/0011_tearful_gateway.sql` and matching snapshot metadata.

## TDD

- RED/GREEN coverage includes unknown pricing, balance and budget rejection, Provider-call reserve/settle ordering, failure release, RBAC denial, and credential-reference redaction.
- PostgreSQL-conditional coverage includes concurrent reserve serialization, duplicate settle, and stale reservation reconciliation.

## Verification

- Target quota/admin/usage/runtime/Scheduler suite: 22 passed, 19 PostgreSQL-conditional skipped.
- Client and target regression suite: 60 passed, 19 PostgreSQL-conditional skipped.
- Full Vitest suite: 534 passed, 51 PostgreSQL-conditional skipped.
- Playwright responsive suite: 8 passed.
- TypeScript typecheck: passed.
- Production build: passed.
- Drizzle check: passed.
- Git diff check: passed.

## Concerns

- PostgreSQL-conditional tests require `TEST_DATABASE_URL`; the current environment skipped them explicitly.
- Streaming reservations settle when the AI SDK emits its finish usage event. Abrupt Worker termination relies on startup reconciliation after two lease periods.
- Actual Provider usage can exceed the estimate and produce an explicit debt balance. Future reserves remain blocked until an administrator adjustment restores available balance.

## Durable Settlement Follow-Up

- Replaced prompt-derived call IDs with persisted call-instance records scoped by task, Agent, Provider, model, and logical sequence. Identical independent calls receive distinct IDs; retries restore the same post-checkpoint sequence ID. The latest durable checkpoint advances the per-scope cursor.
- Added reservation lifecycle records containing task ID, lease version, status, and heartbeat. Reconciliation releases only stale reservations whose matching task lease is missing, expired, terminal, or fenced by a newer lease version.
- Added a durable settlement/release outbox. Provider completion enqueues terminal work before processing; transient settlement failures retain the reservation and remain retryable. Late usage after reconciliation charges actual usage without double-refunding the estimate.
- Stream finish events settle known usage. Provider errors, stream read errors, iterator return, and cancellation release through the durable outbox. Stream pulls refresh reservation heartbeat, while the active task lease prevents false release during long gaps.
- Long-lived Workers run periodic outbox processing and stale-reservation reconciliation, with startup reconciliation retained.
- Platform credentials now execute through the Provider chain. `env:NAME` resolves a named environment credential; `credential:UUID` resolves an encrypted credential owned by the recorded administrator. Responses expose only `environment` or `encrypted`.
- Balance adjustment and audit insertion now share one transaction and both use request-level idempotency. Platform model create/update/disable/delete operations are audited; deletion requires prior disablement.
- User concurrency changes and administrator cap reductions share one advisory transaction lock, lock the current settings/user rows, and preserve `user concurrency <= platform maximum` under races.
- Usage APIs explicitly convert PostgreSQL numeric values and expose independent per-Agent and per-model totals for tokens, cost, latency, credential sources, price sources, and unknown-price state.
- Admin UI tests cover pricing updates, disable confirmation, and disabled-model deletion. PostgreSQL-conditional tests cover real repository balance/audit idempotency, delete semantics, and concurrency races.

## Follow-Up Verification

- Target quota/admin/usage/runtime/Scheduler suite: 32 passed, 23 PostgreSQL-conditional skipped.
- Full Vitest suite, run independently: 544 passed, 55 PostgreSQL-conditional skipped.
- Playwright responsive suite, run independently: 8 passed.
- TypeScript typecheck: passed.
- Production build: passed.
- Drizzle migration check: passed.
- Git diff check: passed.
- Running full Vitest and Playwright concurrently caused one unrelated existing Agent test timeout and one first-page Playwright timeout from resource contention. Independent reruns passed completely and are the final evidence above.

## Follow-Up Concerns

- PostgreSQL-conditional tests require `TEST_DATABASE_URL`; this environment skipped the four quota and three administrator repository cases.
- JavaScript cannot deterministically detect a consumer that abandons a `ReadableStream` without cancelling or returning its iterator. Stream heartbeat stops after Provider stream creation, active leases protect long calls, and lease expiry plus periodic reconciliation closes that crash/abandon path.
