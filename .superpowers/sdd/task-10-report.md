# Task 10 Report

## Status

Implemented the literary AI-native creative workbench with a responsive three-column desktop layout and three-destination mobile navigation. The workbench consumes project detail data, streams resumable run events, presents chapter text and bounded activity history, and sends steering instructions through the existing run API.

## TDD

- RED: workbench tests failed because the page, event reducer, and panel components were absent.
- GREEN: event projection, duplicate suppression, stream-delta merging, 200-event retention, reflection progress, chapter viewing, steering, mobile URL state, reconnect/backpressure announcements, panel width controls, and incremental updates pass.
- RED: jsdom exposed unsupported `scrollTo` use during panel restoration.
- GREEN: scroll restoration uses the standard `scrollTop` property and preserves per-panel positions.

## Realtime

- WebSocket subscriptions reconnect with `after=<lastSequence>` and bounded exponential backoff from 1 to 15 seconds.
- Monotonic sequence projection ignores duplicate or stale events.
- Stream chunks merge into live prose while structured events retain a bounded 200-item window.
- Connected, reconnecting, backpressure, parsing-error, and idle states use visible status or alert regions.

## Layout And Navigation

- Desktop uses literary editorial panels for manuscript structure, live writing, and run/Agent/usage state.
- Side panels support collapse plus native range controls for keyboard-operable width adjustment.
- Mobile widths below 768px render one region at a time with exactly three bottom destinations: 作品, 创作, 状态.
- Panel, chapter, and run context remain in the deep-link query string; panel switching stores scroll positions and moves focus into the selected region.
- Chapter navigation displays persisted body text when supplied by the project detail response.

## Accessibility

- Native landmarks, headings, labels, range inputs, `aria-current`, `aria-expanded`, live status, alert regions, skip link, visible focus treatment, and 44px controls are present.
- Existing reduced-motion handling applies to workbench transitions and loading motion.
- Axe WCAG 2 A/AA reports zero detectable violations for the workbench.

## Scope

- Pause, resume, and abort appear as disabled placeholders with explanatory titles, following the Task 10 assignment boundary.
- AskUser, model switching, diagnostics, and control-side command behavior remain outside this task.

## Verification

- Workbench component tests: 7 passed.
- Frontend component and axe tests: passed with zero detectable workbench violations.
- Full Vitest suite: 420 passed, 43 PostgreSQL-conditional skipped.
- Playwright Chromium: 8 passed across 375, 768, 1024, and 1440 pixel viewports.
- TypeScript: passed.
- Production build: passed.
- Drizzle migration check: passed.
- Git diff check: passed.

## Concerns

- The current Task 4 project detail route returns project metadata only. Chapter arrays and latest-run metadata need a backend projection before production data can populate those workbench regions.
- PostgreSQL-conditional tests require `TEST_DATABASE_URL` and remain skipped in this environment.
- The bounded event window intentionally retains the latest 200 structured events; durable history remains available through server persistence and cursor replay.

## Projection And Realtime Hardening

- Added authenticated `GET /api/projects/:projectId/workbench`, backed by tenant-scoped project, latest run, latest chapter versions, task, checkpoint, event, and usage tables.
- Projection work is bounded to a fixed query set: project and latest-run lookup followed by parallel chapter/task/checkpoint/event/usage queries. Chapter count and Agent count do not increase query count.
- Empty projects return `chapters: []`, `latestRun: null`, `agents: []`, zero usage, and `pendingQuestion: null`.
- Agent state is projected from latest runtime events, task state, and checkpoint Agent snapshots. Usage totals and per-Agent rows aggregate `usage_records`.
- The browser consumes production `stream.delta` events from `payload.text`; legacy `stream`, `stream_delta`, and `payload.delta` remain compatible.
- Reconnect attempts reset after a received event or five stable seconds. Consecutive 1013 closes retain exponential state, use capped jittered delays, and reconnect with the last projected cursor.
- `popstate` restores panel, chapter, focus region, and stored panel scroll position.

## Control Hardening

- Pause, resume, and abort use the existing tenant-scoped run command API; abort requires explicit confirmation.
- AskUser answers and model switch requests use validated explicit endpoints and durable command IDs.
- Worker command delivery dispatches structured AskUser/model commands to matching Host capabilities and falls back to durable steer semantics for existing Host implementations.
- Diagnostics uses a tenant-scoped projection of run status, latest event cursor, and checkpoint version.
- Static Agent guesses and usage placeholders were removed from the right sidebar.

## Hardening Verification

- Full Vitest suite: 434 passed, 45 PostgreSQL-conditional skipped.
- Target PostgreSQL projection coverage: 2 conditional tests added for tenant isolation, latest chapter version, task/checkpoint Agent state, usage aggregation, and empty projects.
- WebSocket coverage: production stream protocol, cursor replay, disconnect-window recovery, duplicate suppression, and 1013 backpressure.
- Frontend coverage: real protocol projection, legacy compatibility, consecutive 1013 backoff, control APIs, Agent/usage rendering, and history restoration.
- Playwright Chromium: 8 passed at 375, 768, 1024, and 1440 pixels using the production workbench response schema.
- Axe WCAG A/AA, TypeScript, production build, Drizzle migration check, and Git diff check passed.

## Updated Concerns

- PostgreSQL-conditional tests require `TEST_DATABASE_URL`; 45 tests remain skipped in this environment, including the 2 new workbench projection tests.
- Default `Host` currently exposes steer but does not expose optional hot model swap or external answer methods. Structured commands are durable and Worker-ready; specialized Host adapters receive direct capability calls, while the default Host consumes them as steering instructions at an Agent boundary.

## Live Control Synchronization Follow-up

- Usage projection now treats `usage_records` as cumulative snapshots. It selects the newest snapshot per Agent/credential source/provider/model dimension and totals only those latest values.
- `ModelSet` supplies hot-swappable model handles to Coordinator role agents and reflective reviewers. `Host.switchModel` persists role selections in run metadata and restores them before resumed work.
- Default Host AskUser uses a deterministic question ID, persists the public question and durable answer in the runtime queue, resolves an active waiter, and reuses the answer after Host reconstruction.
- Worker renewal polling delivers AskUser/model commands while an Agent call is suspended; command claiming and acknowledgement preserve exactly-once durable delivery.
- Host usage observations emit hash-stable public usage snapshots. The browser reducer updates live Agent and usage projections from production events.
- Worker durable commit enter/exit updates run control state. Abort responses and workbench projection expose `waiting_for_durable_commit`; the UI keeps the waiting status until a terminal event arrives.
- Applied answer commands suppress answered AskUser projections. The UI removes a submitted question immediately and prevents duplicate submission.
- Run controls, diagnostics, AskUser, model switching, and steering catch API/network failures, include request IDs when present, and expose retry actions.

## Follow-up Verification

- Added unit coverage for cumulative snapshot selection, dynamic model handles, default Host AskUser recovery/model persistence, live Agent/usage reducer updates, durable abort state, answered-question suppression, and control retry behavior.
- Added PostgreSQL-conditional integration coverage chaining latest usage snapshots, AskUser projection, applied answer suppression, Agent/checkpoint state, and tenant isolation.
- Playwright continues to use production-compatible projection fields at 375, 768, 1024, and 1440 pixels.
- Task 15 remains responsible for full-system browser-to-Worker E2E with a real PostgreSQL service and Provider execution.

## Current Concerns

- PostgreSQL-conditional tests require `TEST_DATABASE_URL` and remain skipped when that service is unavailable.
- Full-system AskUser suspension, Worker delivery, provider hot swap, and browser completion are covered across unit/integration boundaries here; Task 15 will provide the single real-service E2E chain.

## Final Synchronization Gate

- Vitest: 439 passed, 45 PostgreSQL-conditional skipped.
- Playwright Chromium: 8 passed across 375, 768, 1024, and 1440 pixel viewports. One initial Vite startup timing failure was non-reproducible; the isolated retry and complete rerun passed.
- TypeScript, production build, Drizzle migration check, and Git diff check passed.
