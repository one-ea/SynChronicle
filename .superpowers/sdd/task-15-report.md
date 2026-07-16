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

## Local Verification

- `pnpm typecheck`: passed.
- `pnpm test`: 637 passed, 62 PostgreSQL-conditional skipped.
- `pnpm vitest run src/web/security/security.test.ts src/providers/urlPolicy.test.ts`: 61 passed.
- `pnpm build`: passed; tsup and Vite production outputs generated.
- `pnpm exec playwright test --list`: passed; desktop and mobile real-stack cases discovered.
- `npm pack --dry-run`: passed after the production build; 50 files, 843.7 kB package including Vite client assets.
- `git diff --check`: passed.

## CI-Only Gates

- Isolated PostgreSQL migration and all 62 conditional tests with zero skips.
- Real browser E2E against PostgreSQL, Web, and Worker.
- Docker image build.
- `docker compose config`.
- Full Compose readiness/Worker smoke workflow.

Task list and final acceptance remain unchecked for gates that require successful CI execution.
