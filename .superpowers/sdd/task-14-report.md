# Task 14 Implementation Report

## Scope

- Added a Node.js 24 multi-stage production image with a non-root runtime user.
- Added Web, Worker, migration, and PostgreSQL Compose services with one published Web port, persistent PostgreSQL storage, health checks, resource limits, restart policies, and migration completion gates.
- Added database wait, advisory-locked migration, quota reconciliation, liveness, readiness, and graceful Web shutdown behavior.
- Added placeholder-only project environment configuration for database access, public URL, session signing, credential master-key versions, and Provider host policy.
- Added backup, restore, key rotation, Worker scaling, quota reconciliation, and troubleshooting procedures.
- Added container deployment contract tests and CI image/config validation.

## TDD Evidence

The health and deployment tests first failed because `/api/health/live`, `/api/health/ready`, `Dockerfile`, `compose.yaml`, `.env.web.example`, and the operations runbook were absent. Migration-lock and graceful-shutdown tests first failed because their modules were absent. The implementation was then added until all targeted tests passed.

## Verification

- `pnpm vitest run src/web/health/health.test.ts src/db/maintenance.test.ts src/web/shutdown.test.ts scripts/container-deployment.test.ts`: 8 passed.
- `pnpm typecheck`: passed.
- `pnpm build`: passed; generated CLI, Web, Worker, maintenance, and Vite client artifacts.
- `pnpm test`: 621 passed and 62 PostgreSQL-conditional tests skipped because `TEST_DATABASE_URL` was unavailable.
- `git diff --check`: passed.
- Secret-pattern scan found only intentional fake-token fixtures in pre-existing migration tests.

## Environment Limits

The implementation environment has no Docker CLI. `docker compose config`, `docker build`, and live Compose smoke tests require a Docker-capable host and are enforced by `.github/workflows/container-ci.yml`.

## P1/P2 Follow-up

- Container CI now runs a bounded Compose smoke test for PostgreSQL, migration completion, Web readiness/liveness, and Worker container health. Failure traps collect service state and logs before removing volumes.
- Readiness now verifies every migration from the image journal by exact SHA-256 hash and `created_at` value.
- `credential-reencrypt` provides dry-run, bounded row-locked batches, current-key envelope replacement, metadata-only audit events, idempotent restart, and revoked/invalid exclusion.
- Deployment contract tests execute `docker compose config` when Docker exists, validate shell syntax and executable bits, and exercise backup, restore, reconciliation, and credential rotation help paths.
- Web shutdown enters not-ready drain state, rejects new application requests, closes WebSockets, waits for the drain interval, and closes Fastify. Compose grants Web and Worker at least 45 seconds.
- Local follow-up verification passed 16 focused deployment tests, 621 full-suite tests, typecheck, production build, shell syntax checks, executable/help checks, and `git diff --check`.
- Docker is unavailable locally. The deployment contract test statically requires the CI workflow and smoke script gates; a Docker-capable runner performs Compose config, build, migration, readiness/liveness, Worker health, log capture, and volume cleanup.
