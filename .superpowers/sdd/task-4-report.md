# Task 4 Implementation Report

## Status

- Implemented tenant-scoped project authorization, CRUD, archival, optimistic version checks, and mutation auditing.
- Registered project routes through the Task 3 `authenticateRequest` decorator.

## RED

- Added `src/web/projects/projects.test.ts` before production implementation.
- Initial command: `pnpm vitest run src/web/projects/projects.test.ts`.
- Expected failure observed: `Cannot find module './routes.js'`, confirming the project route/repository feature was absent.

## GREEN

- Added strict Zod schemas for project IDs, create, update, and archive payloads.
- Added a `ProjectRepository` whose list/get/update/archive queries explicitly bind `auth.userId`; create explicitly writes `auth.userId`.
- Added consistent foreign/missing 404 handling, active-only default listing, retained archived rows, and 409 version conflicts.
- Added audit writes for successful, invalid, missing, conflicting, and exceptional create/update/archive attempts, including actor, action, target, result, and Fastify request ID.
- Final isolated project test: 6 passed.

## Self-review

- Verified every project repository operation is tenant scoped.
- Verified foreign and missing resources share the same 404 status and response body for reads, updates, and archives.
- Kept audit-write errors outside mutation exception handlers to avoid a duplicate audit attempt for the same request/action uniqueness key.
- Confirmed archive updates status/timestamp/version while preserving the project row and excluding it from default lists.

## Verification

- `pnpm vitest run src/web/projects/projects.test.ts`: 6 passed.
- `pnpm vitest run src/web/auth/auth.test.ts`: 13 passed.
- `pnpm typecheck`: passed.
- `pnpm test`: 307 passed, 5 skipped.
- `pnpm build`: passed.
- `git diff --check`: passed.
- One project-test run timed out while all verification commands ran concurrently; the same suite passed in the concurrent full run and passed again alone in 572 ms.

## Commit

- Message: `feat(web): add isolated project management`

## Concerns

- PostgreSQL-backed project integration tests require `TEST_DATABASE_URL`; this environment ran route/repository contract tests and skipped the existing PostgreSQL-only suites when that variable was absent.
- Project mutations and audit inserts use separate database statements. A database failure during the audit insert can leave a completed mutation without its audit row; transactional composition can address this in a later task if atomic audit persistence becomes a requirement.

## Independent Review Fixes

- Critical: create/update/archive and success audit insertion must share one database transaction; audit failure rolls back the project mutation.
- Important: configure UUID request IDs so the audit uniqueness contract survives process restarts.
- Important: add failure-injection and conditional PostgreSQL tests proving audit failure rolls back project changes.
- Minor: centralize update/archive result-to-audit mapping.

## Atomic Audit Remediation

### RED

- Added failure-injection tests for create, update, and archive using a fake transaction runner that commits cloned state only after the callback succeeds.
- Initial run failed because `ProjectMutationService` was absent and the server response had no `x-request-id` header.

### GREEN

- Added `ProjectMutationService`; each successful create/update/archive and its success audit now execute in one Drizzle transaction.
- Made `ProjectRepository` and `AuditRepository` accept either the root database or a transaction executor.
- Kept invalid, missing, conflict, and exceptional mutation audits on the root audit repository after confirming no business mutation committed.
- Added UUID Fastify `genReqId` and returned the same ID in `x-request-id`; route tests confirm audit records use that response ID.
- Centralized mutation result mapping in `mutationResultAuditResult`.
- Added conditional PostgreSQL integration tests that reserve the audit uniqueness key and verify create/update/archive rollback.

### Verification

- Project/auth/schema targets: 30 passed, 5 skipped.
- `pnpm typecheck`: passed.
- `pnpm test`: 312 passed, 8 skipped.
- `pnpm build`: passed.
- `pnpm exec drizzle-kit check`: passed with schema and migrations synchronized.
- `git diff --check`: passed.

### Remaining Concerns

- `TEST_DATABASE_URL` was absent, so the new three PostgreSQL rollback tests and the existing five PostgreSQL-dependent tests were skipped. Fake transaction tests exercised all three rollback paths in this environment.
