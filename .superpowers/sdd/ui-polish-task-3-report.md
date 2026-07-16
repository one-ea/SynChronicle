# UI Polish Task 3 Report

## Status

Completed the Task 3 Playwright checks for reachable create-run controls and layout-safe responsive behavior. No production CSS change was required after rebuilding the current source.

## Changes

- Added a production-valid workbench model set with a configured Writer Agent and matching provider/model catalog.
- Verified the layout trigger is hidden at 375px and 768px.
- Verified the layout trigger is visible at 1024px and 1440px, opens the layout dialog, and keeps the dialog inside the viewport.
- Used a 500px-tall viewport to verify the create-run card remains reachable by scrolling.
- Verified the model-set select and start-run button have an actual rendered height of at least 48px.
- Selected the model set, verified the start-run CTA becomes enabled, and verified it can be scrolled fully inside the viewport.

## TDD Evidence

The first responsive browser run used the existing build output and failed in the expected areas:

- 375px reported a 44px model-set select.
- 768px did not expose the mobile workbench navigation.
- 1024px and 1440px did not expose the layout trigger.

After rebuilding the current source, the same eight responsive tests passed. This confirmed the prior UI polish source changes already contained the required breakpoint and 48px control styling, so Task 3 needed test coverage only.

## Review Follow-up

The review exposed that the initial browser fixture used an empty `agents` record and empty provider catalog. A new failing assertion exercised the production `validateModelSetInput` path and rejected that fixture at all four workbench widths. The fixture now contains a Writer Agent using `openai/gpt-5`, a matching provider/model catalog, and valid parameters. Each workbench case selects the model set before asserting that the enabled CTA remains fully reachable in the short viewport.

## Responsive Server Isolation Follow-up

The responsive validation command previously inherited the global full-stack `webServer` and failed before test collection when `TEST_DATABASE_URL` was absent. A tested server selector now uses Vite on port 4173 with the root page as its readiness URL when the selected project set contains only `responsive` and PostgreSQL is unavailable. Full-stack project selections, runs without a project filter, and runs with `TEST_DATABASE_URL` continue to use `scripts/e2e-server.ts` and `/api/health/ready`.

TDD evidence for this follow-up:

- The original `pnpm exec playwright test --project=responsive` command failed with `TEST_DATABASE_URL is required`.
- The first selector assertion failed because responsive-only runs still returned the e2e-server command.
- After wiring the selector into `playwright.config.ts`, the four configuration cases passed and the standard responsive command passed all eight tests without a database environment variable.

## Verification

- `pnpm vitest run scripts/playwright-server.test.ts`: passed, 4 tests.
- `pnpm vitest run src/web/client/workbench/workbench.test.tsx src/web/client/app.a11y.test.tsx`: passed, 32 tests.
- `pnpm typecheck`: passed.
- `pnpm build`: passed.
- `pnpm exec playwright test --project=responsive`: passed, 8 tests with the isolated Vite server and no database environment variable.
- Public preview connectivity on port 5173: passed.

## Preview

Public preview: https://5173-d0d19cba6cc31e88.monkeycode-ai.online

## Concerns

The Playwright web server logs an existing Worker startup error while binding a JavaScript `Date` value through `postgres` during quota reservation reconciliation. The responsive suite uses mocked browser API responses and all eight tests pass despite that separate Worker process error. This issue is outside Task 3 scope and remains visible for follow-up.
