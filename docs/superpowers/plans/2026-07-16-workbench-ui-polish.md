# Workbench UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make run creation fully reachable in the sidebar and replace exposed width sliders with an accessible layout popover.

**Architecture:** Keep existing Workbench state and APIs. Add a focused layout-control component, refine `RunSidebar` markup, and update the existing token-driven CSS without introducing dependencies.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Testing Library, Playwright.

## Global Constraints

- Preserve the literary editorial visual language and existing semantic color tokens.
- Keep all interactive targets at least 44px high.
- Support keyboard operation, Escape dismissal, focus restoration, and reduced motion.
- Keep mobile panel navigation unchanged and hide desktop width controls below 768px.
- Do not change backend APIs or run command behavior.

---

### Task 1: Accessible Layout Popover

**Files:**
- Create: `src/web/client/workbench/layoutControls.tsx`
- Modify: `src/web/client/pages/workbench.tsx`
- Modify: `src/web/client/styles/global.css`
- Test: `src/web/client/workbench/workbench.test.tsx`

**Interfaces:**
- Consumes: `leftWidth`, `rightWidth`, and their state setters from `WorkbenchPage`.
- Produces: `LayoutControls` with labeled sliders, pixel values, reset, outside-click dismissal, Escape dismissal, and focus restoration.

- [ ] **Step 1: Write failing interaction tests**

Add tests that open `布局`, assert labels and current pixel values, change both ranges, reset to `280/300`, close with Escape, close by outside click, and restore focus to the trigger.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run src/web/client/workbench/workbench.test.tsx`

Expected: FAIL because the `布局` trigger and popover do not exist.

- [ ] **Step 3: Implement `LayoutControls`**

Use a button with `aria-expanded` and `aria-controls`. Render an anchored `role="dialog"` panel while open, move focus to its first range, listen for Escape and pointer events outside the component, and restore focus on close. Reset widths to `280` and `300`.

- [ ] **Step 4: Replace inline ranges and style the popover**

Remove `.panel-width-controls` markup from `WorkbenchPage`, render `LayoutControls`, and add compact topbar trigger/popover styles. Hide it under the existing mobile breakpoint.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm vitest run src/web/client/workbench/workbench.test.tsx`

Expected: PASS.

### Task 2: Reachable Create-Run Card

**Files:**
- Modify: `src/web/client/workbench/runSidebar.tsx`
- Modify: `src/web/client/styles/global.css`
- Test: `src/web/client/workbench/workbench.test.tsx`
- Test: `src/web/client/app.a11y.test.tsx`

**Interfaces:**
- Consumes: existing `modelConfiguration`, `pending`, and `onStart` behavior.
- Produces: a `run-create-card` with helper copy, explicit model-set label, disabled-until-selected CTA, and safe bottom scrolling.

- [ ] **Step 1: Write failing form tests**

Assert the start button is disabled before selection, enabled after selecting a model set, helper text is associated with the select, and submission still calls `onStart` once.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run src/web/client/workbench/workbench.test.tsx src/web/client/app.a11y.test.tsx`

Expected: FAIL because the current CTA is enabled before selection and the helper relationship is absent.

- [ ] **Step 3: Implement controlled model-set selection**

Track `selectedModelSetId`, disable the CTA when empty or pending, add `aria-describedby`, and preserve existing submit/error handling.

- [ ] **Step 4: Refine sidebar layout**

Style the form as a bordered card, use 48px select/button controls, add clear spacing, and add sidebar-body bottom padding using `max(var(--space-6), env(safe-area-inset-bottom))` so the CTA remains reachable.

- [ ] **Step 5: Verify UI and accessibility**

Run: `pnpm vitest run src/web/client/workbench/workbench.test.tsx src/web/client/app.a11y.test.tsx`

Expected: PASS with no axe violations.

### Task 3: Responsive Regression And Preview

**Files:**
- Modify: `tests/browser/webui-responsive.spec.ts`

- [ ] **Step 1: Add browser assertions**

At 1024px and 1440px, assert the layout trigger opens a panel that remains inside the viewport. At 375px and 768px, assert the desktop control is hidden. Assert the create-run CTA can be scrolled fully into view and has at least 44px height.

- [ ] **Step 2: Run verification**

Run: `pnpm vitest run src/web/client/workbench/workbench.test.tsx src/web/client/app.a11y.test.tsx && pnpm typecheck && pnpm build && pnpm exec playwright test --project=responsive`

Expected: all commands pass.

- [ ] **Step 3: Restart preview and smoke test**

Restart the Vite preview if required and verify the public preview renders the new layout controls and reachable create-run card.
