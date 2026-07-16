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

- Focused lifecycle and deployment tests: 17 passed.
- `pnpm typecheck`: passed.
- `pnpm build`: passed; generated CLI, Web, Worker, maintenance, and Vite client artifacts.
- `pnpm test`: 628 passed and 62 PostgreSQL-conditional tests skipped because `TEST_DATABASE_URL` was unavailable.
- `git diff --check`: passed.
- Secret-pattern scan found only intentional fake-token fixtures in pre-existing migration tests.

## Environment Limits

The implementation environment has no Docker CLI. `docker compose config`, image build, and live Compose smoke tests are configured in `.github/workflows/container-ci.yml` and remain pending execution on a Docker-capable runner.

## P1/P2 Follow-up

- Container CI is configured to run a bounded Compose smoke test for PostgreSQL, migration completion, Web readiness/liveness, and Worker container health. Failure traps collect service state and logs before removing volumes. This workflow was not executed in the local environment.
- Readiness now verifies every migration from the image journal by exact SHA-256 hash and `created_at` value.
- `credential-reencrypt` provides dry-run, bounded row-locked batches, current-key envelope replacement, metadata-only audit events, idempotent restart, and revoked/invalid exclusion.
- Deployment contract tests execute `docker compose config` when Docker exists, validate shell syntax and executable bits, and exercise backup, restore, reconciliation, and credential rotation help paths.
- Web shutdown enters not-ready drain state, rejects new application requests, closes WebSockets, waits for the drain interval, and closes Fastify. Compose grants Web and Worker at least 45 seconds.
- Docker is unavailable locally. Deployment contract tests statically require the CI workflow and smoke script gates; their runtime result remains pending a Docker-capable runner.

## Lifecycle Hardening Follow-up

- Worker startup removes stale readiness before database initialization. The ready record contains the actual Node PID, a startup nonce, and timestamp; the container healthcheck validates the recorded PID, nonce/timestamp shape, process existence, and `/proc/<pid>/cmdline`. Matching readiness is removed during normal, signalled, and runner-error shutdown paths.
- Restore requires `--confirm-restore`, an exact `DEPLOYMENT_ENV` match, and a non-empty PostgreSQL custom-format dump. It stops Web and Worker, restores into a new timestamped candidate database, runs migration and readiness there, renames the previous database to a timestamped backup, switches the candidate, and restarts only after validation. Failures keep services stopped and print retained database recovery guidance.
- `SHUTDOWN_DRAIN_MS` now accepts only finite non-negative integer milliseconds from 0 through 30000, preserving at least 15 seconds inside the 45-second Compose stop grace period.
- Local evidence for this follow-up: 17 focused tests, restore mock execution, shell syntax/help checks, 628 full-suite tests, typecheck, production build, and `git diff --check`. Docker CI evidence remains pending workflow execution.
