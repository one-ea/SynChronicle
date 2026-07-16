# UI Polish Task 1 Report

## Status

Completed the accessible `LayoutControls` popover while preserving the existing Workbench width state, collapsed panels, three-column grid, and mobile navigation behavior.

## TDD Evidence

- Baseline: `pnpm vitest run src/web/client/workbench/workbench.test.tsx` passed 21 tests.
- RED: the new interaction tests failed because the `布局` trigger did not exist (3 expected failures, 20 existing tests passed).
- GREEN: `pnpm vitest run src/web/client/workbench/workbench.test.tsx` passed 23 tests.

## Implementation

- Added an independent `LayoutControls` component with `aria-expanded`, `aria-controls`, and an anchored `role="dialog"` panel.
- Added explicitly labeled `作品栏` and `状态栏` sliders with tabular pixel values.
- Added reset behavior for the existing defaults: `280px` and `300px`.
- Added initial focus, Escape dismissal, outside-pointer dismissal, and trigger focus restoration.
- Replaced the exposed inline ranges in the Workbench top bar.
- Reused editorial color, spacing, border, focus, and motion tokens.
- Kept interactive targets at least 44px and hid the control below the existing 768px desktop breakpoint.
- Kept the popover out of normal flow to avoid layout movement when opening and closing.

## Verification

- Workbench: 23 tests passed.
- Accessibility: 7 tests passed, including axe scanning with the layout dialog open.
- Typecheck: `tsc --noEmit` passed.
- Diff hygiene: `git diff --check` passed.

## Concerns

- Responsive browser viewport assertions remain assigned to Task 3 in the existing implementation plan.

## Review Follow-up

- Extended the complete Workbench mobile/tablet responsive block through `768px`, keeping the hidden layout control, single active panel, and bottom navigation on one breakpoint.
- Added regression coverage for closing from a second trigger click.
- Added explicit outside-pointer dismissal and trigger focus restoration coverage.
- Added assertions that range changes update `--left-open-width` and `--right-open-width` on the Workbench grid.
- RED: 24 tests passed and the new breakpoint regression failed because the Workbench CSS had no `max-width: 768px` block.
- GREEN: all 25 Workbench tests passed after the breakpoint alignment.

## Final Minor Review

- Added `aria-haspopup="dialog"` to the layout trigger.
- Split dismissal focus behavior by intent: Escape and a second trigger click restore trigger focus; outside pointer dismissal preserves focus on the newly targeted control.
- Updated the responsive browser test to identify `.run-sidebar` as the nearest overflow container and measure the create-run CTA against that container viewport.
- Added a minimum `16px` CTA-to-sidebar-bottom safety assertion at 375px, 768px, 1024px, and 1440px.
- RED: focused tests failed for the missing popup relationship and outside dismissal stealing focus; the initial responsive assertion also exposed an overly strict overflow detection predicate.
- GREEN: focused tests passed 29/29, accessibility tests passed 7/7, and responsive tests passed 8/8.
