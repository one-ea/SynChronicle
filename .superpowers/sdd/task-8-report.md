# Task 8 Report

## Status

Implemented resumable run-event streaming over authenticated Fastify WebSockets.

## RED / GREEN

- RED: `src/web/realtime/realtime.test.ts` initially failed because the realtime repository, broker, and route modules were absent.
- GREEN: replay, live wakeups, cursor resumption, race closure, duplicate suppression, tenant authorization, Origin validation, cleanup, and backpressure tests pass.
- RED: the Worker persistence test observed zero event-sink writes because Host iterables were only drained.
- GREEN: Host events and Agent-labeled `stream.delta` chunks are persisted before their PostgreSQL wakeups are published.

## Protocol

- Endpoint: `GET /ws/runs/:runId?after=<sequence>`.
- `after` is a non-negative safe integer and an exclusive cursor.
- Messages are persisted `run_events` rows serialized as JSON and ordered by ascending `sequence`.
- Replay uses pages of at most 500 rows, then subscribes, then pulls once more to close the replay-subscribe race.
- Every notification and LISTEN reconnect is only a wakeup; clients pull authoritative rows from PostgreSQL after their current cursor.
- Duplicate and out-of-order wakeups are harmless because delivery advances only for rows with `sequence > cursor`.

## Backpressure And Cleanup

- A connection closes with WebSocket code `1013` and reason `Slow consumer` when `bufferedAmount` exceeds the configured threshold.
- Close, error, setup failure, and server shutdown paths remove subscriptions.
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
- Stable IDs are idempotent within a run, covering duplicate observation paths.
- Worker publication happens only after `appendEvent` resolves its committed transaction.

## Concerns

- PostgreSQL-backed integration tests remain environment-gated when `TEST_DATABASE_URL` is absent.
- Backpressure uses `ws.bufferedAmount`, so the threshold should be tuned with production payload sizes and latency.
