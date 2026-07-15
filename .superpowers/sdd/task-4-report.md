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
