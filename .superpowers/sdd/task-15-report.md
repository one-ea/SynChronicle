# Task 15 Report

## Status

Implemented the production security layer, deterministic real-stack E2E harness, PostgreSQL zero-skip CI release gate, and the remaining progress-ledger Minor fixes. Database, browser runtime, Docker, and Compose execution remain assigned to Web CI because this environment has no PostgreSQL client/service or Docker engine.

## Security

- One Fastify plugin owns nonce-based CSP without `unsafe-eval`, HTTPS HSTS, `nosniff`, frame deny and `frame-ancestors 'none'`, referrer policy, permissions policy, body limits, same-origin mutation checks, route/client rate limits, admin-prefix authentication/RBAC, recursive error redaction, and generic request-correlated error responses.
- The import route retains a 50 MiB streaming limit while ordinary request bodies use 1 MiB. Oversized declared and chunked bodies return 413.
- Trusted proxy handling defaults to disabled and accepts only explicit IP/CIDR entries. Boolean-wide trust is rejected during configuration parsing.
- Existing origin and admin checks were consolidated into the production plugin. Credential mutation limits and login credential verification limits remain specialized controls.

## E2E And CI

- Playwright defines desktop Chrome and Pixel 7 projects against a real Web server, PostgreSQL database, migrations, seed users, and Worker.
- The browser scenario covers login, project creation/archive, run creation, pause/resume/steer/AskUser/model switch/abort, export/import, cross-tenant 404, and responsive workbench navigation.
- Worker execution uses the real Scheduler, Host, database Store, event persistence, quota path, and lease loop. Only AI SDK model output is deterministic, injected behind `NODE_ENV=test` plus `SYNCHRONICLE_E2E_FAKE_PROVIDER=1`; no external model request is possible.
- PostgreSQL conditional suites retain dedicated coverage for WebSocket replay ordering, deduplication, Worker crash/lease recovery, fencing, durable commit, quota settlement, concurrency, migration, credentials, and tenant isolation.
- Web CI installs Chromium/runtime dependencies, runs migrations, produces a Vitest JSON report, fails on any skipped conditional test, builds tsup/Vite, runs Playwright, checks the npm package, builds Docker, validates Compose, and runs the container smoke workflow.

## TDD Evidence

- Security RED: the target suite failed because `src/web/security/plugin.ts` was absent. GREEN: 5 security plugin tests passed.
- Trusted proxy RED: the prior boolean schema rejected an explicit allowlist and accepted broad trust. GREEN: explicit IP/CIDR parsing passes and `true` is rejected.
- Transport RED: synchronous requester creation left one overall timer active. GREEN: the requester throw path clears the timer and the 56-test URL policy suite passes.

## CI-Only Gates

- Isolated PostgreSQL migration and all 62 conditional tests with zero skips.
- Real browser E2E against PostgreSQL, Web, and Worker.
- Docker image build.
- `docker compose config`.
- Full Compose readiness/Worker smoke workflow.

Task list and final acceptance remain unchecked for gates that require successful CI execution.

## Follow-up: Full Worker Web Flow

The follow-up replaces API-only command assertions with UI-driven controls and condition-based waits against a localhost-only test orchestrator. The orchestrator records real database state, controls Worker process death/restart, and exposes the test-only Provider call log without adding production routes.

- The deterministic Provider uses the AI SDK v2 protocol directly and no longer imports `ai/test` or its unavailable optional test dependencies.
- Provider calls record method, Provider, model, Worker ID, PID, timestamp, and prompt only when the explicit E2E test flags and log path are configured.
- The first model invokes the real `ask_user` tool. The switched model invokes the real `reopen_book` tool against prepared fixture state, producing a matching checkpoint through the actual Host/Store path.
- Playwright waits for task claim, Provider calls, live AskUser UI, command applied feedback, pause boundary, checkpoint, resume, lease expiry, second-Worker reclaim, resumed Provider execution, stream replay, task completion, usage, quota, chapter, and artifact facts.
- Start, pause, resume, steer, AskUser answer, model switch, abort, import, and export are exercised through visible WebUI controls. Cross-tenant access remains a direct authorization assertion.
- Playwright now discovers the original eight 375/768/1024/1440 responsive cases plus desktop and mobile full-stack cases.

### Follow-up TDD Evidence

- RED: fake Provider tests failed because `ai/test` required unavailable `msw`, calls were not logged, and tools were not executed. GREEN: the direct v2 model logs calls and completes real AskUser/reopen-book tool loops.
- RED: orchestrator tests failed because process control did not exist and then because kill returned before process exit. GREEN: Worker kill waits for exit and restart uses a distinct identity.
- RED: a live AskUser event appeared in the activity feed without rendering the answer form. GREEN: Workbench projects live tool events into the pending-question UI and submits the durable answer command.
- RED: direct CLI dispatch coverage loaded real Web configuration. GREEN: injected lazy starters verify Web and Worker dispatch without starting services.

### Minor Ledger

Closed: Fastify test cleanup, direct CLI dispatch coverage, Argon2 build/test follow-up, ephemeral PostgreSQL CI configuration, dense artifact/chapter Schema formatting, unused `clearHandledSteer`, stale Task 9 reporting, and synchronous Provider transport timer cleanup.

Retained risk: the IPv6 special-purpose range policy requires periodic maintenance as IANA assignments evolve.

## Durable Artifact Verification Follow-up

- The checkpoint preparation route remains limited to crash-recovery input. Playwright captures run-scoped chapter and artifact baselines immediately after preparation.
- The recovery Worker explicitly exposes `draft_chapter` and `commit_chapter` to the deterministic Coordinator. The fake Provider invokes those real Host tools after lease reclaim; it does not insert final chapter or artifact rows directly.
- Completion requires exactly one new chapter version and exactly one matching draft artifact containing the deterministic Provider output. Assertions bind the output stream stable ID to the run and task and require one durable completion stable ID.
- Full-stack imports use unique run and checkpoint UUIDs per Playwright project. The crash/recovery scenario has a 180-second budget and restores connectivity and disposes the control client in `finally`.
- The progress ledger has one consolidated Task 12 entry. PostgreSQL, browser, Docker, Compose, and smoke evidence remains assigned to CI and unchecked in the task list.

## Latest Local Verification

- Target suite: 90 passed across deterministic Provider, crash orchestrator, Agent/Host execution, Workbench, security, CLI, and Web server coverage.
- `pnpm test`: 648 passed; 62 PostgreSQL-conditional tests skipped explicitly because PostgreSQL is unavailable locally.
- `pnpm typecheck`: passed.
- `pnpm build`: passed; tsup and Vite production outputs generated.
- `pnpm exec playwright test --list`: passed; eight responsive cases across 375/768/1024/1440 and two full-stack Worker cases collected.
- `npm pack --dry-run`: passed; 50 files, 848.9 kB package including Vite client assets.
- `git diff --check`: passed.

PostgreSQL-backed Vitest, full Playwright execution, Docker build, Compose config, and Compose smoke remain pending CI evidence and stay unchecked.

## Final Integration Gap Wave

- Quota reservation, provider-started, heartbeat, settlement, release, and outbox writes now require the matching active task lease. Reclaimed attempts receive lease-scoped model call IDs; stale provider-started/provider-completed attempts are estimate-reconciled through the maintenance path.
- Quota heartbeat and maintenance loops are serialized, rejection-safe, and observable. Lease loss aborts the Provider request and bounds settlement retries with the same abort signal.
- Realtime client state resets cursor, reducer projection, stream, reconnect state, and command projection when `runId` changes. Regression covers sequence 99 on the old run followed by sequence 1 on the new run.
- Workbench lifecycle events, control/start completion, and reconnect trigger a deduplicated deferred snapshot refresh. The full-stack Playwright scenario now asserts completed status and durable chapter body in browser UI.
- Durable commit state stores `{ taskId, leaseVersion }`, clears on matching exit, finish, expiry, and reclaim, and cannot be cleared by an older Worker. API/UI waiting state only recognizes the current active task marker.
- Authentication records login success/failure, logout, and password-change outcomes with request ID, actor/target, result, IP, and time. Unknown usernames are represented by SHA-256 only; audit failures are best-effort and logged.
- Worker run-loop failures use injected structured logging with secret redaction and capped exponential backoff.

### Final Wave Local Evidence

- Target regressions: passed; PostgreSQL-conditional cases remain skipped without `TEST_DATABASE_URL`.
- `pnpm typecheck`: passed.
- `pnpm build`: passed.
- `pnpm exec playwright test --list`: passed; 10 tests collected.
- `npm pack --dry-run`: passed; 50 files, 860.7 kB package.
- `pnpm drizzle-kit check`: passed.
- `git diff --check`: passed.

PostgreSQL-backed Vitest, full Playwright execution, Docker build, Compose config, and Compose smoke remain pending CI evidence and stay unchecked.
