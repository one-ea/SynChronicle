# Multi-User WebUI SDD Progress

Branch base: ecd02f2
Plan: .monkeycode/specs/2026-07-15-multi-user-webui/tasklist.md

Task 1: complete (commits ecd02f2..9fbc752, review clean)
Minor: `src/web/server.test.ts` can close Fastify in `try/finally`; final review should triage.
Minor: dynamic CLI dispatch lacks a direct test; Task 1 brief only required parsing and health coverage.
Follow-up for Task 3: add `argon2` to pnpm `onlyBuiltDependencies` and verify real Argon2id hashing.
Task 2: complete (commits 9fbc752..f4c2c8a, review clean)
Minor: PostgreSQL integration tests leave random rows in a shared database; final CI should use an ephemeral database.
Final gate: run migrations and conditional integration tests with an isolated `TEST_DATABASE_URL`.
Task 3: complete (commits f4c2c8a..cdd4924, review clean)
Final gate: execute 5 conditional PostgreSQL tests with `TEST_DATABASE_URL`; local static/unit suite currently skips them explicitly.
Task 4: complete (commits cdd4924..687dfdb, review clean)
Final gate: execute 3 project audit rollback tests with `TEST_DATABASE_URL`; fake transaction tests cover local rollback behavior.
Task 5: complete (commits 687dfdb..1ee8cf0, review clean)
Minor: new artifact/chapter Schema definitions are dense single lines; final formatter/readability review should triage.
Final gate: execute 10 DatabaseStore PostgreSQL contract tests with `TEST_DATABASE_URL`.
Task 6: complete (commits 1ee8cf0..e7e3376, review clean)
Final gate: execute 13 Scheduler PostgreSQL tests with an isolated `TEST_DATABASE_URL`.
Architecture note: Scheduler uses a global transaction advisory lock for correctness; future throughput work may introduce finer lock scopes.
Task 7: complete (commits e7e3376..9858836, spec approved, no Critical/Important)
Minor: remove unused non-atomic `StorePort.clearHandledSteer()` API before final merge.
Final gate: execute 37 PostgreSQL conditional tests with isolated `TEST_DATABASE_URL`, including Worker fencing and crash recovery.
Task 8: complete (commits 9858836..c190060, review clean)
Final gate: execute 43 PostgreSQL conditional tests with isolated `TEST_DATABASE_URL`, including cross-instance event streaming.
Task 9: complete (commits c190060..9333b48, review clean)
Minor: consolidate stale validation counts and cwd note in `task-9-report.md` before final documentation pass.
Final gate: CI must install Playwright Chromium/runtime and execute four responsive browser cases.
Task 10: complete (commits 9333b48..cbca149, review clean)
Final gate: execute 46 PostgreSQL conditional tests and full browser-to-Worker flow in Task 15.
Task 11: complete (commits cbca149..8eddad8, review pass with Low findings)
Low: maintain IPv6 special-purpose range list and clear overall timer if transport creation synchronously throws.
Final gate: execute credential and model-set PostgreSQL conditions with isolated `TEST_DATABASE_URL`.
Task 12: complete (commits 8eddad8..5f386c9, code review approved)
Final gate: execute all quota/admin/concurrency PostgreSQL tests with zero skips; monitor settlement AbortSignal test stability.
Task 13: complete (commits 5f386c9..42e705f, review approved)
Final gate: execute `src/migration/migration.postgres.test.ts` with isolated `TEST_DATABASE_URL`.
Task 14: complete (commits 42e705f..743d75d, implementation approved)
Final gate: Docker-capable CI must pass image build and full Compose smoke workflow.
Task 12: complete (append-only quota ledger, admin controls, usage/settings UI, dynamic Scheduler caps)
Final gate: execute quota concurrency, duplicate settlement, crash reconciliation, RBAC, and dynamic Scheduler PostgreSQL conditions with isolated `TEST_DATABASE_URL`.
Task 12 durability follow-up: complete candidate (persisted call contexts, lease-aware reservation heartbeats, durable terminal outbox, platform credential execution, transactional admin audit, serialized caps, independent usage summaries, full model lifecycle UI/API).
Final gate remains PostgreSQL execution with isolated `TEST_DATABASE_URL`; local sequential full Vitest and Playwright gates pass.
Task 15: implementation complete candidate (production security plugin, strict trusted proxies, real PostgreSQL/Web/Worker E2E harness with test-only deterministic Provider, zero-skip CI gate, release documentation).
Task 15 local gate: typecheck, 637 Vitest tests, tsup/Vite build, Playwright discovery, npm pack dry-run, and diff check passed; 62 PostgreSQL-conditional tests, browser E2E, Docker build, Compose config, and Compose smoke await Docker/PostgreSQL-capable CI.
Task 15 minors closed: removed unused `clearHandledSteer`, consolidated stale Task 9 verification reporting, and cleared the Provider transport overall timer after synchronous requester failure.
