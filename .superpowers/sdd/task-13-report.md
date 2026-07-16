# Task 13 Report

## Status

Implemented tenant-isolated project import/export for PostgreSQL, legacy file-project migration, WebUI controls, audit records, and archive hardening.

## Archive And Security

- Added version 1 `synchronicle-project` ZIP archives with project metadata, chapter/artifact indexes, per-entry versions, SHA-256 checksums, and export timestamps.
- Import validates the `.sync.zip` extension, ZIP MIME type, declared and streamed byte limits, manifest schema, entry limits, duplicate/unindexed entries, checksums, and normalized paths.
- Absolute paths, drive paths, traversal paths, NUL paths, unsupported ZIP encodings, secret/credential/password/token/API-key fields, and checksum mismatches are rejected before database insertion.
- Server errors pass through the existing secret redactor. Audit metadata contains counts and format versions only.

## PostgreSQL And Migration

- Archive import creates the project, completed run, chapters, artifacts, and success audit in one transaction, so insertion or audit failure rolls back the complete import.
- Export reads a repeatable-read user-scoped snapshot and selects matching latest chapter/artifact versions from one run before producing the archive.
- Cross-tenant project export returns the same not-found result as a missing project.
- Added `migrate-project --database-url ... --username ... --dir ...`; all three values are explicit and the username is resolved before importing the legacy file project.
- Existing TXT/EPUB file export remains unchanged.

## WebUI

- Added accessible archive selection, upload progress announcement, completion/error feedback, tenant-scoped download, disabled export state, and optimistic-conflict recovery text.
- Controls retain keyboard labels, visible focus behavior, reduced-motion behavior, mobile layout, and at least 44px touch targets.
- Downloads use a server-generated allowlisted `Content-Disposition` filename and a streamed Fastify response.

## TDD

- RED/GREEN cycles covered missing archive modules, versioned round trips, traversal paths, checksum mismatch, sensitive fields, stream size limits, legacy conversion, upload validation, tenant routing, safe downloads, UI progress/conflicts, and explicit CLI migration arguments.

## Verification

- Target tests: 31 passed.
- `pnpm vitest run`: 585 passed, 59 skipped; PostgreSQL-conditional suites were skipped because `TEST_DATABASE_URL` is absent.
- `pnpm test:browser`: 8 passed on the final independent rerun.
- `pnpm typecheck`: exit 0.
- `pnpm build`: exit 0.
- `pnpm exec drizzle-kit check`: exit 0.
- `git diff --check`: exit 0.

## Concerns

- PostgreSQL integration coverage requires `TEST_DATABASE_URL`; this environment exercised unit, route, UI, CLI, schema, build, and browser gates while conditional database suites reported skips.
- Import consumes the request incrementally with hard limits, then validates the bounded ZIP buffer before opening the transaction. The 50 MiB default cap bounds memory use.
- Export streams the completed archive in 64 KiB response chunks. Archive construction remains bounded in memory by current project content size; a future ZIP data-descriptor writer could make archive construction fully incremental for very large projects.

## High And Medium Hardening Follow-Up

- Replaced buffered database export with a backpressure-aware async ZIP producer. A capacity-one channel keeps the repeatable-read transaction open for the complete response consumption and prevents database pagination from outrunning the HTTP consumer.
- Chapter and artifact discovery uses UUID cursors and bounded pages. A second bounded query pass streams only selected latest-version rows; no complete project archive or complete project body set is assembled in memory.
- Export preflights exact stored-ZIP size and every entry size before the first response byte. Total overflow returns 413 and entry overflow returns 422.
- Export requires the caller's expected project version, the latest completed run, its referenced checkpoint, and matching checkpoint/project versions. Missing projects return 404; stale or unstable snapshots return 409.
- The manifest now records source run metadata, checkpoint metadata, planning indexes, and review indexes. Schema validation enforces unique chapter sequences, artifact types, index types, normalized paths, checkpoint versions, and artifact-backed planning/review references.
- Artifact filenames use immutable artifact UUIDs, eliminating sanitized-type collisions.
- JSON artifacts receive recursive sensitive-key scanning. Text artifacts reject explicit secret assignments and long Bearer values while allowing narrative mentions of words such as password or secret.
- ZIP import now validates EOCD and central-directory structure, local/central name/flag/method/size/CRC agreement, stored and deflate payloads, signed or unsigned data descriptors, duplicate normalized paths, encryption, symlinks, multi-disk archives, ZIP64 markers, entry count, entry size, total size, and compression ratio.
- Successful import and export audits remain transactionally coupled. Rejected and failed operations write bounded metadata through best-effort failure auditing; an audit outage preserves the original request error.
- WebUI export sends the expected project version. Import disables project operations, reports measurable upload progress through an ARIA live region, supports cancellation, and retains keyboard and axe coverage.
- CLI migration tests verify database connection closure after both success and failure.

## Hardening Verification

- Task 13 target tests: 46 passed, 2 PostgreSQL-conditional tests skipped.
- `pnpm vitest run`: 597 passed, 61 skipped. The two new real PostgreSQL archive tests were discovered and skipped because `TEST_DATABASE_URL` is absent.
- `pnpm test:browser`: 8 passed.
- `pnpm typecheck`: exit 0.
- `pnpm build`: exit 0.
- `pnpm exec drizzle-kit check`: exit 0.
- `git diff --check`: exit 0.

## Hardening Concerns

- The current environment has no `TEST_DATABASE_URL`, so the real PostgreSQL round-trip, tenant isolation, stable-run selection, and audit rollback tests could not execute here. They remain part of the normal conditional suite.
- ZIP64 is explicitly rejected. Current project/export caps stay below classic ZIP field limits.
- Entry bodies are bounded in memory one row at a time because PostgreSQL text/json values arrive as one field. Archive-wide buffering has been removed.
