# Task 8 Report

## Status

Implemented resumable run-event streaming over authenticated Fastify WebSockets.

## RED / GREEN

- RED: `src/web/realtime/realtime.test.ts` initially failed because the realtime repository, broker, and route modules were absent.
- GREEN: replay, live wakeups, cursor resumption, race closure, duplicate suppression, tenant authorization, Origin validation, cleanup, serialized-byte backpressure, and broker failure tests pass in the default test suite.
- RED: the Worker persistence test observed zero event-sink writes because Host iterables were only drained.
- GREEN: Host events and Agent-labeled `stream.delta` chunks use persisted Host chunk sequences, deterministic stable IDs, and append-before-publish ordering.

## Protocol

- Endpoint: `GET /ws/runs/:runId?after=<sequence>`.
- `after` is a non-negative safe integer and an exclusive cursor.
- Messages are persisted `run_events` rows serialized as JSON and ordered by ascending `sequence`.
- Replay uses pages of at most 500 rows, then subscribes, then pulls once more to close the replay-subscribe race.
- Every notification and LISTEN reconnect is only a wakeup; clients pull authoritative rows from PostgreSQL after their current cursor.
- Duplicate and out-of-order wakeups are harmless because delivery advances only for rows with `sequence > cursor`.

## Backpressure And Cleanup

- A connection closes with WebSocket code `1013` and reason `Slow consumer` when `bufferedAmount + UTF-8 serialized message bytes` exceeds the configured threshold.
- Close, socket error, asynchronous listener rejection, setup failure, broker close, and server shutdown paths remove subscriptions.
- Per-connection pulls are serialized and coalesced to avoid concurrent cursor races.

## Security

- Cookie session authentication runs before upgrade.
- Origin must exactly match the configured public URL origin.
- Run lookup is constrained by authenticated `userId`; the resolved `userId/projectId/runId` scope constrains every event query.
- Invalid cursors and run IDs fail before upgrade.
- Foreign and missing runs return the same 404 response and receive no events.

## Self Review

- Database rows remain the source of truth; LISTEN/NOTIFY carries no event payload used for delivery.
- Sequence allocation locks the owned run row and inserts within the same transaction.
- Stream stable IDs use `runId/taskId/agent/chunkSequence`; public event persistence occurs inside the Host callback before the chunk reaches the Runner.
- Worker publication happens only after `appendEvent` resolves its committed transaction.

## Hardening Follow-up RED / GREEN

- RED: rejected async broker listeners escaped as unhandled rejections; GREEN: broker dispatch catches them and invokes the subscriber error callback, which closes and unsubscribes the WebSocket.
- RED: a failed initial LISTEN retained both its listener and rejected cached Promise; GREEN: subscription state rolls back and subsequent subscribe retries LISTEN.
- RED: backpressure ignored the next serialized payload; GREEN: UTF-8 message bytes are included before every send.
- RED: stream deltas had `stableId: null` and process-local ordering; GREEN: Worker injects deterministic public stream persistence into Host, and database uniqueness deduplicates a retried task/chunk identity.

## Durable Sequencing Follow-up

- RED: DatabaseStore, realtime repository, and Scheduler allocated `run_events.sequence` with different lock strategies; GREEN: every PostgreSQL `run_events` insert uses `appendRunEventInTransaction`, which locks the owned run row and allocates the next sequence.
- RED: each Worker chunk created an internal `stream_delta` row and a public `stream.delta` row; GREEN: Worker Host persists one public `stream.delta` row and Runner only publishes its committed `eventSequence`.
- WebSocket replay reads only rows with a stable ID and excludes legacy internal `stream_delta` rows.
- The conditional PostgreSQL suite mixes concurrent DatabaseStore and realtime repository writes and verifies one unique monotonic sequence.
- The conditional Worker crash test precommits a chunk before notification, recovers with a new Worker, and verifies one public row with the original ID and sequence.
- The conditional broker test closes a real publisher client to force NOTIFY failure, then verifies a later notification causes cursor-based DB backfill of both rows.

## PostgreSQL Conditional Coverage

- `src/realtime/eventRepository.postgres.test.ts` runs when `TEST_DATABASE_URL` is configured.
- It covers concurrent mixed-writer monotonic sequence allocation, stable-ID uniqueness, public-event filtering, two independent PostgreSQL clients using LISTEN/NOTIFY, notification-triggered DB pull, commit-before-publish observation, real publish failure, and later-notify backfill.
- Broker unit tests cover initial LISTEN failure rollback, retry, reconnect wakeup, rejected-listener cleanup, and close cleanup without requiring a live PostgreSQL service.

## Concerns

- PostgreSQL-backed integration assertions execute only when `TEST_DATABASE_URL` is present; a run without it reports those cases as skipped.
- Backpressure uses `ws.bufferedAmount`, so the threshold should be tuned with production payload sizes and latency.
