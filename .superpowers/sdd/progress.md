# Multi-User WebUI SDD Progress

Branch base: ecd02f2
Plan: .monkeycode/specs/2026-07-15-multi-user-webui/tasklist.md

Task 1: complete (commits ecd02f2..9fbc752, review clean)
Closed in Task 15 follow-up: `src/web/server.test.ts` closes shared Fastify fixtures through `try/finally`.
Closed in Task 15 follow-up: dynamic CLI Web/Worker dispatch has direct injected-starter coverage.
Closed before Task 15: `argon2` is in pnpm `onlyBuiltDependencies` and real Argon2id hashing is covered.
Task 2: complete (commits 9fbc752..f4c2c8a, review clean)
Closed in Task 15 implementation: Web CI provisions an ephemeral PostgreSQL service; execution evidence remains a CI gate.
Final gate: run migrations and conditional integration tests with an isolated `TEST_DATABASE_URL`.
Task 3: complete (commits f4c2c8a..cdd4924, review clean)
Final gate: execute 5 conditional PostgreSQL tests with `TEST_DATABASE_URL`; local static/unit suite currently skips them explicitly.
Task 4: complete (commits cdd4924..687dfdb, review clean)
Final gate: execute 3 project audit rollback tests with `TEST_DATABASE_URL`; fake transaction tests cover local rollback behavior.
Task 5: complete (commits 687dfdb..1ee8cf0, review clean)
Closed in Task 15 follow-up: artifact/chapter Schema columns use readable one-field-per-line formatting.
Final gate: execute 10 DatabaseStore PostgreSQL contract tests with `TEST_DATABASE_URL`.
Task 6: complete (commits 1ee8cf0..e7e3376, review clean)
Final gate: execute 13 Scheduler PostgreSQL tests with an isolated `TEST_DATABASE_URL`.
Architecture note: Scheduler uses a global transaction advisory lock for correctness; future throughput work may introduce finer lock scopes.
Task 7: complete (commits e7e3376..9858836, spec approved, no Critical/Important)
Closed in Task 15 implementation: removed unused non-atomic `StorePort.clearHandledSteer()` API.
Final gate: execute 37 PostgreSQL conditional tests with isolated `TEST_DATABASE_URL`, including Worker fencing and crash recovery.
Task 8: complete (commits 9858836..c190060, review clean)
Final gate: execute 43 PostgreSQL conditional tests with isolated `TEST_DATABASE_URL`, including cross-instance event streaming.
Task 9: complete (commits c190060..9333b48, review clean)
Closed in Task 15 implementation: consolidated stale Task 9 validation counts and static-root note.
Final gate: CI must install Playwright Chromium/runtime and execute four responsive browser cases.
Task 10: complete (commits 9333b48..cbca149, review clean)
Final gate: execute 46 PostgreSQL conditional tests and full browser-to-Worker flow in Task 15.
Task 11: complete (commits cbca149..8eddad8, review pass with Low findings)
Risk retained: periodically maintain the IPv6 special-purpose range list as IANA assignments evolve.
Closed in Task 15 implementation: clear the overall Provider transport timer when requester creation throws synchronously.
Final gate: execute credential and model-set PostgreSQL conditions with isolated `TEST_DATABASE_URL`.
Task 12: complete (commits 8eddad8..5f386c9, code review approved; append-only quota ledger, admin controls, usage/settings UI, dynamic Scheduler caps, and durability follow-up included)
Final gate: execute quota concurrency, duplicate settlement, crash reconciliation, RBAC, dynamic Scheduler caps, and all remaining PostgreSQL conditions with zero skips; monitor settlement AbortSignal test stability.
Task 13: complete (commits 5f386c9..42e705f, review approved)
Final gate: execute `src/migration/migration.postgres.test.ts` with isolated `TEST_DATABASE_URL`.
Task 14: complete (commits 42e705f..743d75d, implementation approved)
Final gate: Docker-capable CI must pass image build and full Compose smoke workflow.
Task 15: implementation complete (commits 743d75d..c0fce04, review approved)
Final gate: Web CI must run PostgreSQL conditions with zero skips, full Playwright, Docker build/config/smoke before Task 15 acceptance boxes are checked.
Long-term risk: maintain Provider IPv6 special-purpose address registry alongside IANA updates.
Task 15: implementation complete candidate (production security plugin, strict trusted proxies, real PostgreSQL/Web/Worker E2E harness with test-only deterministic Provider, zero-skip CI gate, release documentation).
Task 15 local gate: typecheck, 637 Vitest tests, tsup/Vite build, Playwright discovery, npm pack dry-run, and diff check passed; 62 PostgreSQL-conditional tests, browser E2E, Docker build, Compose config, and Compose smoke await Docker/PostgreSQL-capable CI.
Task 15 minors closed: removed unused `clearHandledSteer`, consolidated stale Task 9 verification reporting, and cleared the Provider transport overall timer after synchronous requester failure.
Task 15 follow-up candidate: real Worker/Provider observability, UI-only control flow, controlled Worker crash/restart, live AskUser projection, responsive plus full-stack Playwright projects, expanded direct security tests, server cleanup, CLI dispatch coverage, and Schema readability are implemented. PostgreSQL/browser/container evidence remains pending CI.
Final integration gap wave: lease-version-fenced quota attempts/outbox, fenced durable commit markers, run-scoped realtime reset, deferred Workbench snapshot refresh, auth audit coverage, Provider heartbeat abort, and Worker logging/backoff are implemented locally.
Final integration local gate: target regressions, typecheck, tsup/Vite build, Playwright discovery, npm pack dry-run, Drizzle check, and diff check passed. PostgreSQL conditional tests, full browser execution, Docker, Compose, and smoke remain pending CI and stay unchecked.
Terminal run synchronization wave: public run/checkpoint lifecycle events, continuously connected snapshot refresh, pre-aborted Provider release/listener cleanup, and throttled/session-race login audit are implemented with target TDD coverage.
Terminal synchronization local gate: 659 Vitest tests, target tests, typecheck, build, Playwright discovery, npm pack dry-run, Drizzle check, and diff check passed. 63 PostgreSQL-conditional tests, full browser execution, Docker, Compose, and smoke remain pending CI and stay unchecked.
Responsive redesign Task 1: complete (commits 3fc4fdb..e5f85b8, review clean).
Responsive redesign Task 2: complete (commits e5f85b8..0dcb35d, spec and quality approved).
Responsive redesign Task 3: complete (commits 0dcb35d..e643984, review clean).
Responsive redesign Task 4: complete (commits e643984..1520b27, review clean).
Responsive redesign Task 5: complete (commits 1520b27..8bf0ea6, review clean; prior focus filtering and viewport isolation minors closed).
Responsive redesign final review gaps: complete (commit 37d403f; review approved with no Critical/Important findings).
Responsive editorial visual refresh: complete (commit 85e7050; 46 Workbench, 6 CSS contract, 4 A11y, and 16 responsive Playwright checks passed in isolated sequential verification).
Task 1: complete (commits 71c99ee..13396dd, review clean)
Task 2: complete (commits 13396dd..eac52e5, review clean)
Task 3: complete (commits eac52e5..6a335f1, review clean)
