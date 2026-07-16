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

- `pnpm vitest run src/quota src/web/admin src/web/usage src/runtime/usage.test.ts src/scheduler`: exit 0; PostgreSQL-conditional cases report skips when `TEST_DATABASE_URL` is absent.
- `pnpm test`: exit 0 on the final independent run.
- `pnpm test:browser`: exit 0 on the final independent run.
- `pnpm typecheck`: exit 0.
- `pnpm build`: exit 0.
- `pnpm exec drizzle-kit check`: exit 0.
- `git diff --check`: exit 0.

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

- `pnpm vitest run src/quota src/web/admin src/web/usage src/runtime/usage.test.ts src/scheduler src/web/client/pages`: exit 0; conditional PostgreSQL suites state their skip status explicitly.
- `pnpm test`: exit 0 on the final independent run.
- `pnpm test:browser`: exit 0 on the final independent run.
- `pnpm typecheck`, `pnpm build`, `pnpm exec drizzle-kit check`, and `git diff --check`: exit 0.
- Running full Vitest and Playwright concurrently caused one unrelated existing Agent test timeout and one first-page Playwright timeout from resource contention. Independent reruns passed completely and are the final evidence above.

## Follow-Up Concerns

- PostgreSQL-conditional tests require `TEST_DATABASE_URL`; this environment skipped the four quota and three administrator repository cases.
- JavaScript cannot deterministically detect a consumer that abandons a `ReadableStream` without cancelling or returning its iterator. Stream heartbeat stops after Provider stream creation, active leases protect long calls, and lease expiry plus periodic reconciliation closes that crash/abandon path.

## Stable Accounting Follow-Up

- Host, Agent, and Reviewer now create durable logical invocation keys before entering the AI SDK. Worker allocation uses a task-scoped PostgreSQL advisory lock and a unique task/invocation key, so separate wrappers allocate distinct call IDs while crash retries reuse the original ID. The quota wrapper no longer owns or derives a sequence and rejects missing invocation context.
- Generate completion waits until the actual-usage settlement intent is durably inserted. Stream finish chunks wait for the same durable intent before delivery. Transient intent failures use bounded exponential retry; exhausted retries append an estimate-charge fallback and mark the reservation `needs_reconciliation`.
- Reservation state distinguishes `provider_completed` and `needs_reconciliation`. Reconciliation preserves provider-completed calls with an actual-usage outbox intent, estimate-settles only provider-completed calls whose actual intent is missing, and releases only calls that never completed at the Provider.
- Outbox processing records a bounded exponential `nextAttemptAt`, allowing process restart and periodic Worker maintenance to resume actual settlement without exposing a premature terminal result.
- Usage API platform warnings come from current active `platform_models` metadata and pricing policy. Settings displays unavailable unknown-price models even when no historical settlement exists.
- Dedicated usage projection and Settings warning tests cover numeric conversion and current platform-model availability.

## Stable Accounting Verification

- `pnpm vitest run src/quota/quota.test.ts src/agents/agents.test.ts src/agents/reflection/reviewer.test.ts src/web/usage/usage.test.ts src/web/client/pages/settings.test.tsx`: exit 0.
- Full-gate command evidence is appended from the final run below; no fixed test totals are used because conditional PostgreSQL execution depends on `TEST_DATABASE_URL`.

## Final Stabilization

- The quota wrapper now consumes the model-call ID allocated before the AI SDK boundary directly, preserving one durable ID across Provider wrappers.
- Agent and Reviewer calls use deterministic instance-local invocation sequences, so independent calls and Reviewer retries remain distinct while crash replay starts from the same logical sequence.
- Settlement enqueue retries retain the full actual-usage payload in the estimate fallback. Reconciliation recreates the actual settlement intent and processes it; Provider completions with no recoverable actual payload close at the reserved estimate.
- Migration `0014_worthless_beyonder.sql` is required for the new enum states, invocation key, Provider completion timestamp, outbox retry timestamp, and task/invocation uniqueness constraint. Its journal and snapshot match the TypeScript schema.
- Final `pnpm test`: 551 passed, 58 skipped; PostgreSQL-conditional suites were skipped because `TEST_DATABASE_URL` is absent.
- Final `pnpm test:browser`: 8 passed.

## Interrupted Provider Call Accounting

- Reservations now persist `provider_started` before entering the Provider. Failure to persist that state blocks the Provider call.
- Reconciliation releases only reservations that never reached `provider_started`. Started or completed calls without durable actual usage settle at the reserved estimate and remain `needs_reconciliation`.
- Stream cancellation, read failure, and EOF without a finish usage event use the same interrupted-call estimate settlement path.
- Actual usage intent persistence retries indefinitely in the live process with bounded exponential delay. A process crash leaves `provider_started` for lease-based estimate reconciliation.
- Reflection state persists `reviewerAttempt`. Candidate and Reviewer invocation keys include the persisted execution ID, reflection round, Reviewer attempt, operation, and task-scoped allocation.
- Platform pricing uses `hasKnownPlatformPrice` across Worker resolution, Scheduler selection, model catalogs, usage projection, and Settings. `priceStatus: unknown` blocks platform usage even when numeric prices remain.
- Budget spend includes actual settlements and unresolved estimate settlements, while a later actual settlement supersedes its estimate to prevent double counting.
- Added migration `0015_charming_wither.sql` and matching snapshot for the `provider_started` reservation state.

## Interrupted Call Verification

- `pnpm test`: 558 passed, 59 skipped.
- `pnpm test:browser`: 8 passed.
- `pnpm typecheck`, `pnpm build`, `pnpm exec drizzle-kit check`, and `git diff --check`: exit 0.
- PostgreSQL-conditional tests include started/unstarted reconciliation and estimate-budget accounting; this environment skipped them because `TEST_DATABASE_URL` is absent.

## Provider Billing Outcomes

- Platform credential resolution, active/known-price checks, Provider factory creation, and method validation now run in a reusable local `prepare` phase before `provider_started`. Preflight failure releases the reservation with audited reason/category metadata.
- `provider_started` is persisted immediately before the prepared Provider dispatch. SDK-local validation inside the Provider operation remains subject to Provider error classification when no transport dispatch hook is available.
- Settlement intent retry accepts the AI SDK abort/lease signal, exits immediately on cancellation, and caps exponential delay. Cancellation leaves `provider_started` for reconciliation and cannot block graceful Worker shutdown.
- Generate or stream finish results without billable usage settle at the estimate and remain `needs_reconciliation`.
- Explicit rejected-request outcomes release reservations: authentication 401/403, validation 400/404, and 429 without usage. Timeout, connection interruption, 5xx, usage-bearing errors, and ambiguous execution outcomes settle at estimate by default. The ambiguous policy can be configured to release.
- Release and estimate-settlement ledger metadata records `reason`, `errorCategory`, and bounded error text.

## Billing Outcome Verification

- `pnpm test`: 567 passed, 59 skipped.
- `pnpm test:browser`: 8 passed on the final full rerun.
- The first browser run had one first-page readiness timeout; the isolated case and complete rerun passed.

## Undispatched Credential Cleanup

- Provider preflight now returns an owned `{ dispatch, dispose }` handle. The quota wrapper disposes it in `finally`, covering `provider_started` persistence failure, cancellation before dispatch, Provider success, and Provider failure.
- Platform credential preparation releases encrypted/environment leases when Provider factory creation or method validation throws before a dispatch handle is returned.
- Removed the unused `settlementRetry.attempts` option; retry duration remains signal-bound with capped exponential delay.
- Invalid stream results now await interrupted estimate settlement and then throw a Provider stream contract error. No fire-and-forget settlement Promise remains.

## Credential Cleanup Verification

- Target suites: 166 passed, 29 skipped.
- `pnpm test`: 570 passed, 59 skipped.
- `pnpm test:browser`: 8 passed.
