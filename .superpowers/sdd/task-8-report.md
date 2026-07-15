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
- Stream stable IDs use `runId/taskId/agent/chunkSequence`; the chunk sequence originates from the persisted Host runtime queue in production.
- Worker publication happens only after `appendEvent` resolves its committed transaction.

## Hardening Follow-up RED / GREEN

- RED: rejected async broker listeners escaped as unhandled rejections; GREEN: broker dispatch catches them and invokes the subscriber error callback, which closes and unsubscribes the WebSocket.
- RED: a failed initial LISTEN retained both its listener and rejected cached Promise; GREEN: subscription state rolls back and subsequent subscribe retries LISTEN.
- RED: backpressure ignored the next serialized payload; GREEN: UTF-8 message bytes are included before every send.
- RED: stream deltas had `stableId: null` and process-local ordering; GREEN: Host emits the sequence returned by durable runtime append and Worker includes it in payload and stable ID.

## PostgreSQL Conditional Coverage

- `src/realtime/eventRepository.postgres.test.ts` runs when `TEST_DATABASE_URL` is configured.
- It covers concurrent monotonic sequence allocation, stable-ID uniqueness, two independent PostgreSQL clients using LISTEN/NOTIFY, notification-triggered DB pull, commit-before-publish observation, and the notify-failure recovery window.
- Broker unit tests cover initial LISTEN failure rollback, retry, reconnect wakeup, rejected-listener cleanup, and close cleanup without requiring a live PostgreSQL service.

## Concerns

- PostgreSQL-backed integration assertions execute only when `TEST_DATABASE_URL` is present; a run without it reports those cases as skipped.
- Backpressure uses `ws.bufferedAmount`, so the threshold should be tuned with production payload sizes and latency.
