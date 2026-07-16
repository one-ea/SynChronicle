# UI Polish Task 2 Report

## Status

Completed the reachable create-run card while preserving the existing run submission, retry, and error handling behavior.

## TDD Evidence

- RED: the focused Workbench and accessibility run failed in 2 expected assertions because the active model set was preselected and the select had no accessible helper description; 27 existing assertions passed.
- GREEN: `pnpm vitest run src/web/client/workbench/workbench.test.tsx src/web/client/app.a11y.test.tsx` passed 29 tests.

## Implementation

- Added a controlled, initially empty model-set selection.
- Disabled the create-run CTA while the selection is empty or submission is pending.
- Added persistent helper copy and associated it with the select through `aria-describedby`.
- Styled the create-run form as an independent bordered card with clear spacing and 48px select/button targets.
- Added safe sidebar-body bottom padding so the CTA remains reachable during scrolling.
- Preserved the existing `onStart`, pending, retry, and error flow and left other sidebar controls unchanged.

## Verification

- Workbench and accessibility: 29 tests passed.
- Typecheck: `tsc --noEmit` passed.
- Diff hygiene: `git diff --check` passed.

## Concerns

- Viewport-level reachability coverage remains assigned to Task 3's responsive Playwright checks.

## Medium/Low Follow-up

- RED: 3 new assertions failed for stale model-set selection, missing pending semantics, and the unavailable-action cursor; 29 existing assertions passed.
- Cleared controlled selection when refreshed model-set options no longer contain the selected ID.
- Based submit availability and the submit guard on membership in the current model-set options.
- Added pending copy, `aria-busy`, a polite live status, and duplicate-click protection while the request remains unresolved.
- Added a create-card-local `not-allowed` cursor for disabled non-busy submission while retaining the global wait cursor for pending work.
- Added component coverage for option removal and restoration, unresolved submission, repeated click attempts, loading copy, busy semantics, live status, and the local cursor rule.
- GREEN: Workbench and accessibility tests passed 32 assertions.
- The 48px target and short-viewport reachability checks remain assigned to Task 3 browser coverage.
