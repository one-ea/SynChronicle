# Responsive Workbench Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the workbench shell so mobile, tablet, and desktop each use a stable, purpose-built layout without overflow or panel overlap.

**Architecture:** Keep `WorkbenchPage` as the single owner of project and run state, then add a small responsive-mode hook and an accessible tablet drawer primitive. Existing project, writing, and run components remain shared while CSS assigns them to mobile task pages, tablet drawers, or desktop columns.

**Tech Stack:** React 19, TypeScript strict, CSS Grid/Flexbox, Vitest, Testing Library, axe-core, Playwright, Vite.

## Global Constraints

- Mobile is `320-767px`, tablet is `768-1199px`, and desktop is `1200px+`.
- Mobile defaults to the writing task and keeps the composer above the bottom navigation and safe area.
- Tablet keeps the writing canvas visible and uses mutually exclusive chapter and run drawers.
- Desktop uses stable 256px and 320px sidebars with collapse controls and no width sliders.
- Page-level horizontal overflow must remain zero from 375px through 1920px.
- Interactive controls are at least 44px; primary mobile controls are at least 48px.
- Existing API, realtime, chapter selection, run control, model switching, and browser-history behavior must remain intact.

## File Structure

- Create `src/web/client/workbench/useWorkbenchLayout.ts`: resolves and tracks mobile/tablet/desktop mode.
- Create `src/web/client/workbench/workbenchDrawer.tsx`: accessible tablet drawer with focus restore and Escape/outside dismissal.
- Modify `src/web/client/pages/workbench.tsx`: remove width controls, coordinate responsive mode, drawers, mobile task state, and desktop collapse state.
- Modify `src/web/client/workbench/mobileNav.tsx`: add icon-backed task navigation and clearer current-state treatment.
- Modify `src/web/client/workbench/projectNav.tsx`: expose stable heading and close behavior for drawer presentation.
- Modify `src/web/client/workbench/runSidebar.tsx`: expose compact run summary and group mobile status cards.
- Modify `src/web/client/workbench/activityFeed.tsx`: add compact mobile/tablet run summary slot.
- Delete `src/web/client/workbench/layoutControls.tsx` after all imports and tests are removed.
- Modify `src/web/client/styles/global.css`: replace the current two-mode workbench CSS with mobile/tablet/desktop rules.
- Modify `src/web/client/workbench/workbench.test.tsx`: replace layout-slider tests with responsive shell, drawer, navigation, and collapse tests.
- Modify `src/web/client/app.a11y.test.tsx`: cover tablet drawer and mobile workbench states.
- Modify `tests/browser/webui-responsive.spec.ts`: cover six viewports and geometry/focus/safe-area assertions.

---

### Task 1: Responsive Mode and Workbench Shell State

**Files:**
- Create: `src/web/client/workbench/useWorkbenchLayout.ts`
- Modify: `src/web/client/pages/workbench.tsx:1-247`
- Test: `src/web/client/workbench/workbench.test.tsx`

**Interfaces:**
- Produces: `type WorkbenchLayoutMode = "mobile" | "tablet" | "desktop"`.
- Produces: `resolveWorkbenchLayout(width: number): WorkbenchLayoutMode`.
- Produces: `useWorkbenchLayout(): WorkbenchLayoutMode`.
- `WorkbenchPage` adds `data-layout-mode` to `.workbench-shell` and owns `tabletDrawer: "project" | "status" | null`.

- [ ] **Step 1: Write failing resolver and shell tests**

Add these imports and tests to `workbench.test.tsx`:

```tsx
import { resolveWorkbenchLayout } from "./useWorkbenchLayout.js";

it("resolves the three workbench layout ranges", () => {
  expect(resolveWorkbenchLayout(375)).toBe("mobile");
  expect(resolveWorkbenchLayout(767)).toBe("mobile");
  expect(resolveWorkbenchLayout(768)).toBe("tablet");
  expect(resolveWorkbenchLayout(1199)).toBe("tablet");
  expect(resolveWorkbenchLayout(1200)).toBe("desktop");
  expect(resolveWorkbenchLayout(1920)).toBe("desktop");
});

it("removes arbitrary panel width controls from the workbench", () => {
  render(<WorkbenchPage api={api()} project={project} initialEvents={[]} />);
  expect(screen.queryByRole("button", { name: "布局" })).not.toBeInTheDocument();
  expect(document.querySelector(".workbench-shell")).toHaveAttribute("data-layout-mode");
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm vitest run src/web/client/workbench/workbench.test.tsx`

Expected: FAIL because `useWorkbenchLayout.ts` does not exist and the layout trigger still renders.

- [ ] **Step 3: Add the responsive mode hook**

Create `useWorkbenchLayout.ts`:

```ts
import { useEffect, useState } from "react";

export type WorkbenchLayoutMode = "mobile" | "tablet" | "desktop";

export function resolveWorkbenchLayout(width: number): WorkbenchLayoutMode {
  if (width < 768) return "mobile";
  if (width < 1200) return "tablet";
  return "desktop";
}

export function useWorkbenchLayout(): WorkbenchLayoutMode {
  const [mode, setMode] = useState(() => resolveWorkbenchLayout(window.innerWidth));

  useEffect(() => {
    function update() {
      setMode(resolveWorkbenchLayout(window.innerWidth));
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return mode;
}
```

- [ ] **Step 4: Replace width state with responsive shell state**

In `workbench.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { useWorkbenchLayout } from "../workbench/useWorkbenchLayout.js";
```

Remove `CSSProperties`, `LayoutControls`, `leftWidth`, and `rightWidth`. Add:

```tsx
const layoutMode = useWorkbenchLayout();
const [tabletDrawer, setTabletDrawer] = useState<"project" | "status" | null>(null);

useEffect(() => {
  if (layoutMode !== "tablet") setTabletDrawer(null);
}, [layoutMode]);
```

Set the root and grid markup to:

```tsx
<div className="workbench-shell" data-layout-mode={layoutMode}>
  <div className={`workbench-grid left-${leftCollapsed ? "closed" : "open"} right-${rightCollapsed ? "closed" : "open"}`}>
```

Remove the layout controls from the topbar.

- [ ] **Step 5: Run focused tests**

Run: `pnpm vitest run src/web/client/workbench/workbench.test.tsx`

Expected: resolver and no-layout-control tests PASS; old layout-slider tests FAIL and are removed in Step 6.

- [ ] **Step 6: Remove obsolete layout-slider tests and file**

Delete the four tests beginning with:

```ts
it("opens labeled layout controls and resets both panel widths"
it("dismisses layout controls with Escape and restores trigger focus"
it("dismisses layout controls when the trigger is clicked again"
it("dismisses layout controls on an outside pointer interaction without stealing focus"
```

Delete `src/web/client/workbench/layoutControls.tsx` after confirming no imports remain.

- [ ] **Step 7: Verify and commit**

Run: `pnpm vitest run src/web/client/workbench/workbench.test.tsx && pnpm typecheck`

Expected: all focused tests PASS and TypeScript exits 0.

```bash
git add src/web/client/workbench/useWorkbenchLayout.ts src/web/client/pages/workbench.tsx src/web/client/workbench/workbench.test.tsx src/web/client/workbench/layoutControls.tsx
git commit -m "refactor(webui): establish responsive workbench modes"
```

---

### Task 2: Accessible Tablet Drawers

**Files:**
- Create: `src/web/client/workbench/workbenchDrawer.tsx`
- Modify: `src/web/client/pages/workbench.tsx`
- Modify: `src/web/client/workbench/projectNav.tsx`
- Modify: `src/web/client/workbench/runSidebar.tsx`
- Test: `src/web/client/workbench/workbench.test.tsx`

**Interfaces:**
- Produces: `WorkbenchDrawer({ side, label, open, triggerRef, onClose, children })`.
- Consumes: `layoutMode`, `tabletDrawer`, and the existing project/run panel components.
- Tablet triggers have accessible names `打开章节目录` and `打开运行状态`.

- [ ] **Step 1: Write failing tablet drawer tests**

```tsx
it("opens mutually exclusive tablet drawers and restores trigger focus", async () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  fireEvent(window, new Event("resize"));
  const user = userEvent.setup();
  render(<WorkbenchPage api={api()} project={project} initialEvents={[]} />);

  const projectTrigger = screen.getByRole("button", { name: "打开章节目录" });
  const statusTrigger = screen.getByRole("button", { name: "打开运行状态" });
  await user.click(projectTrigger);
  expect(screen.getByRole("dialog", { name: "章节目录" })).toBeVisible();

  await user.click(statusTrigger);
  expect(screen.queryByRole("dialog", { name: "章节目录" })).not.toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "运行状态" })).toBeVisible();

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "运行状态" })).not.toBeInTheDocument();
  expect(statusTrigger).toHaveFocus();
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `pnpm vitest run src/web/client/workbench/workbench.test.tsx -t "tablet drawers"`

Expected: FAIL because drawer triggers and dialogs do not exist.

- [ ] **Step 3: Implement the drawer primitive**

Create `workbenchDrawer.tsx`:

```tsx
import { useEffect, useRef, type ReactNode, type RefObject } from "react";

interface WorkbenchDrawerProps {
  side: "left" | "right";
  label: string;
  open: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose(): void;
  children: ReactNode;
}

export function WorkbenchDrawer({ side, label, open, triggerRef, onClose, children }: WorkbenchDrawerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.querySelector<HTMLElement>("button, [href], input, select, [tabindex='0']")?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        queueMicrotask(() => triggerRef.current?.focus());
        return;
      }
      if (event.key === "Tab" && dialogRef.current) {
        const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")];
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [open, onClose, triggerRef]);

  if (!open) return null;
  return <div className="workbench-drawer-layer">
    <button className="workbench-drawer-backdrop" type="button" aria-label={`关闭${label}`} onClick={() => { onClose(); triggerRef.current?.focus(); }} />
    <div className={`workbench-drawer workbench-drawer-${side}`} role="dialog" aria-modal="true" aria-label={label} ref={dialogRef}>
      <button className="workbench-drawer-close" type="button" onClick={() => { onClose(); triggerRef.current?.focus(); }}>关闭</button>
      {children}
    </div>
  </div>;
}
```

- [ ] **Step 4: Wire tablet triggers and mutually exclusive state**

In `WorkbenchPage`, create refs and render the tablet toolbar only when `layoutMode === "tablet"`:

```tsx
const projectDrawerTrigger = useRef<HTMLButtonElement>(null);
const statusDrawerTrigger = useRef<HTMLButtonElement>(null);

{layoutMode === "tablet" ? <div className="workbench-tablet-toolbar">
  <button ref={projectDrawerTrigger} type="button" onClick={() => setTabletDrawer("project")}>打开章节目录</button>
  <strong>{selectedChapter?.title ?? project.title}</strong>
  <button ref={statusDrawerTrigger} type="button" onClick={() => setTabletDrawer("status")}>打开运行状态</button>
</div> : null}
```

Render each side component exactly once. For desktop, render `ProjectNav` and `RunSidebar` inside the three-column grid. For tablet, render only the writing column in the grid and place `ProjectNav` or `RunSidebar` inside the matching `WorkbenchDrawer`. For mobile, keep the existing single-active-panel structure. Pass a presentation flag to `ProjectNav` and `RunSidebar` so drawer and mobile presentations omit desktop collapse buttons.

- [ ] **Step 5: Verify drawer behavior and commit**

Run: `pnpm vitest run src/web/client/workbench/workbench.test.tsx && pnpm typecheck`

Expected: tablet drawer tests PASS; all existing workbench behavior remains green.

```bash
git add src/web/client/workbench/workbenchDrawer.tsx src/web/client/pages/workbench.tsx src/web/client/workbench/projectNav.tsx src/web/client/workbench/runSidebar.tsx src/web/client/workbench/workbench.test.tsx
git commit -m "feat(webui): add tablet workbench drawers"
```

---

### Task 3: Mobile-First Writing Flow and Run Summary

**Files:**
- Modify: `src/web/client/workbench/mobileNav.tsx`
- Modify: `src/web/client/workbench/activityFeed.tsx`
- Modify: `src/web/client/workbench/runSidebar.tsx`
- Modify: `src/web/client/pages/workbench.tsx`
- Test: `src/web/client/workbench/workbench.test.tsx`

**Interfaces:**
- `MobileNav` continues to consume `current` and `onChange`.
- `ActivityFeed` adds optional `runSummary?: { status: string; score?: number }`.
- Mobile writing remains the default panel when the URL has no valid `panel` value.

- [ ] **Step 1: Write failing mobile navigation and summary tests**

```tsx
it("defaults mobile workbench to writing and exposes a compact run summary", () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
  window.history.replaceState({}, "", "/projects/project-1");
  render(<WorkbenchPage api={api()} project={project} initialEvents={[{
    sequence: 1,
    type: "reflection",
    payload: { round: 2, maxRounds: 3, score: 88, passed: false },
  }]} />);

  expect(screen.getByRole("button", { name: "创作" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("button", { name: "查看运行状态：运行中，88 分" })).toBeVisible();
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `pnpm vitest run src/web/client/workbench/workbench.test.tsx -t "compact run summary"`

Expected: FAIL because the run summary does not exist.

- [ ] **Step 3: Add icon-backed task navigation**

Update `mobileNav.tsx` with inline semantic SVG icons and labels:

```tsx
const panels: Array<{ id: WorkbenchPanel; label: string; path: string }> = [
  { id: "project", label: "章节", path: "M4 5h16M4 12h16M4 19h10" },
  { id: "writing", label: "创作", path: "M4 20l4-1 11-11-3-3L5 16l-1 4Z" },
  { id: "status", label: "运行", path: "M4 12h4l2-6 4 12 2-6h4" },
];

export function MobileNav({ current, onChange }: { current: WorkbenchPanel; onChange(panel: WorkbenchPanel): void }) {
  return <nav className="mobile-workbench-nav" aria-label="创作台区域">
    {panels.map(({ id, label, path }) => <button key={id} type="button" aria-current={current === id ? "page" : undefined} onClick={() => onChange(id)}>
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d={path} /></svg><span>{label}</span>
    </button>)}
  </nav>;
}
```

- [ ] **Step 4: Add compact run summary to the writing canvas**

Extend `ActivityFeed` props and render before `.activity-scroll`:

```tsx
{runSummary ? <button className="mobile-run-summary" type="button" aria-label={`查看运行状态：${runSummary.status}${runSummary.score !== undefined ? `，${runSummary.score} 分` : ""}`} onClick={onOpenRun}>
  <span>{runSummary.status}</span>
  {runSummary.score !== undefined ? <strong>{runSummary.score} 分</strong> : null}
  <span aria-hidden="true">›</span>
</button> : null}
```

Pass `onOpenRun={() => selectPanel("status")}` and derive the score from `state.reflection?.score`.

- [ ] **Step 5: Group mobile run content**

Apply these exact class assignments to the existing `RunSidebar` blocks without changing their callbacks or form fields:

- Wrap `connection-state` and `run-facts` in `<section className="run-summary-card" aria-label="运行摘要详情">`.
- Add `run-progress-card` to the existing `reflection-card` section.
- Add `run-agents-card` to the existing `agent-list` section and move `usage-card` inside it after the Agent list.
- Wrap `control-placeholder`, `abortWaiting`, `commandFeedback`, and `failure` in `<section className="run-actions-card" aria-label="运行操作">`.
- Wrap the pending-question form, model-switch form, and diagnostics section in `<section className="run-configuration-card" aria-label="运行配置">`.

Keep every existing form, callback, accessible label, error message, and retry action intact.

- [ ] **Step 6: Verify mobile behavior and commit**

Run: `pnpm vitest run src/web/client/workbench/workbench.test.tsx src/web/client/app.a11y.test.tsx && pnpm typecheck`

Expected: workbench and WCAG tests PASS.

```bash
git add src/web/client/workbench/mobileNav.tsx src/web/client/workbench/activityFeed.tsx src/web/client/workbench/runSidebar.tsx src/web/client/pages/workbench.tsx src/web/client/workbench/workbench.test.tsx
git commit -m "feat(webui): create mobile-first writing workflow"
```

---

### Task 4: Three-Mode CSS Layout and Overflow Safety

**Files:**
- Modify: `src/web/client/styles/global.css:95-195`
- Test: `src/web/client/workbench/workbench.test.tsx`

**Interfaces:**
- Consumes `.workbench-shell[data-layout-mode]`, `.workbench-drawer-*`, `.mobile-run-summary`, and existing panel classes.
- Produces stable geometry for mobile, tablet, desktop, and 1600px+ screens.

- [ ] **Step 1: Write failing CSS contract assertions**

Add a source-level contract test:

```tsx
it("defines mobile, tablet, desktop, and safe-area workbench contracts", () => {
  const css = readFileSync(resolve(process.cwd(), "src/web/client/styles/global.css"), "utf8");
  expect(css).toContain("@media (max-width: 767px)");
  expect(css).toContain("@media (min-width: 768px) and (max-width: 1199px)");
  expect(css).toContain("@media (min-width: 1200px)");
  expect(css).toContain("env(safe-area-inset-bottom)");
  expect(css).toContain("grid-template-columns: 256px minmax(0, 1fr) 320px");
});
```

- [ ] **Step 2: Run the contract test and verify failure**

Run: `pnpm vitest run src/web/client/workbench/workbench.test.tsx -t "safe-area workbench contracts"`

Expected: FAIL because the old CSS uses a 768px two-mode breakpoint and variable widths.

- [ ] **Step 3: Replace the workbench layout CSS**

Implement these required structural rules in `global.css`:

```css
.workbench-shell { height: 100dvh; min-width: 0; overflow: hidden; }
.workbench-grid, .workbench-grid > div, .workbench-panel { min-width: 0; }
.activity-panel { min-height: 0; }
.activity-scroll { min-height: 0; overflow: auto; }
.chapter-reader, .stream-card, .event-list { max-width: 46rem; }

@media (max-width: 767px) {
  .workbench-shell { padding-bottom: env(safe-area-inset-bottom); }
  .workbench-grid { display: block; height: calc(100dvh - 56px - 68px - env(safe-area-inset-bottom)); }
  .workbench-grid > [data-panel] { display: none; height: 100%; }
  .workbench-grid > [data-mobile-active="true"] { display: block; }
  .writing-column { display: grid; grid-template-rows: minmax(0, 1fr) auto; height: 100%; }
  .mobile-workbench-nav { bottom: env(safe-area-inset-bottom); display: grid; grid-template-columns: repeat(3, 1fr); height: 68px; position: fixed; }
  .mobile-workbench-nav button { min-height: 48px; }
  .mobile-workbench-nav svg { fill: none; height: 20px; stroke: currentColor; width: 20px; }
  .mobile-run-summary { display: flex; min-height: 48px; width: 100%; }
}

@media (min-width: 768px) and (max-width: 1199px) {
  .workbench-grid { display: block; height: calc(100dvh - 58px - 52px); }
  .workbench-grid > [data-panel="project"], .workbench-grid > [data-panel="status"] { display: none; }
  .writing-column { height: 100%; }
  .workbench-tablet-toolbar { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; min-height: 52px; }
  .workbench-drawer-layer { inset: 110px 0 0; position: fixed; z-index: 40; }
  .workbench-drawer { bottom: 0; max-width: min(78vw, 360px); overflow: auto; position: absolute; top: 0; width: 100%; }
  .workbench-drawer-left { left: 0; }
  .workbench-drawer-right { right: 0; }
}

@media (min-width: 1200px) {
  .workbench-grid { display: grid; grid-template-columns: 256px minmax(0, 1fr) 320px; height: calc(100dvh - 58px); }
  .workbench-grid.left-closed { grid-template-columns: 56px minmax(0, 1fr) 320px; }
  .workbench-grid.right-closed { grid-template-columns: 256px minmax(0, 1fr) 56px; }
  .workbench-grid.left-closed.right-closed { grid-template-columns: 56px minmax(0, 1fr) 56px; }
  .mobile-workbench-nav, .workbench-tablet-toolbar, .workbench-drawer-layer, .mobile-run-summary { display: none; }
}

@media (min-width: 1600px) {
  .activity-scroll { padding-inline: clamp(4rem, 8vw, 9rem); }
}
```

Preserve existing visual tokens and component styling while removing `--left-width`, `--right-width`, `.layout-controls*`, and the old `@media (max-width: 768px)` workbench block.

- [ ] **Step 4: Verify CSS and component tests**

Run: `pnpm vitest run src/web/client/workbench/workbench.test.tsx src/web/client/app.a11y.test.tsx && pnpm typecheck`

Expected: all tests PASS and no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/web/client/styles/global.css src/web/client/workbench/workbench.test.tsx
git commit -m "fix(webui): stabilize responsive workbench geometry"
```

---

### Task 5: Multi-Viewport Browser and Accessibility Regression Gate

**Files:**
- Modify: `tests/browser/webui-responsive.spec.ts`
- Modify: `src/web/client/app.a11y.test.tsx`
- Test: `scripts/playwright-server.test.ts`

**Interfaces:**
- Browser matrix: 375, 768, 1024, 1200, 1440, and 1920px.
- Reuses existing API route mocks and `expectInsideViewport`.

- [ ] **Step 1: Expand the viewport matrix and assertions**

Replace the workbench width loop with:

```ts
for (const width of [375, 768, 1024, 1200, 1440, 1920]) {
  test(`creative workbench uses the correct layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await installProjectRoutes(page);
    await page.goto(`/projects/${project.id}?panel=writing&chapter=chapter-1`, { waitUntil: "domcontentloaded" });

    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page.getByRole("heading", { name: "创作流" })).toBeVisible();

    if (width < 768) {
      await expect(page.getByRole("navigation", { name: "创作台区域" })).toBeVisible();
      await expect(page.getByRole("button", { name: "创作" })).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("button", { name: "打开章节目录" })).toBeHidden();
    } else if (width < 1200) {
      const chapterTrigger = page.getByRole("button", { name: "打开章节目录" });
      await expect(chapterTrigger).toBeVisible();
      await chapterTrigger.click();
      await expectInsideViewport(page, page.getByRole("dialog", { name: "章节目录" }));
      await page.keyboard.press("Escape");
      await expect(chapterTrigger).toBeFocused();
    } else {
      await expect(page.getByRole("complementary", { name: "作品结构" })).toBeVisible();
      await expect(page.getByRole("complementary", { name: "运行状态" })).toBeVisible();
      await expect(page.getByRole("button", { name: "布局" })).toHaveCount(0);
    }
  });
}
```

Extract the existing route setup into `installProjectRoutes(page)` so project and workbench tests share one exact mock implementation.

- [ ] **Step 2: Add geometry assertions**

For desktop widths, assert sidebar widths are within tolerance:

```ts
const projectBox = await page.getByRole("complementary", { name: "作品结构" }).boundingBox();
const statusBox = await page.getByRole("complementary", { name: "运行状态" }).boundingBox();
expect(projectBox?.width).toBeGreaterThanOrEqual(250);
expect(projectBox?.width).toBeLessThanOrEqual(262);
expect(statusBox?.width).toBeGreaterThanOrEqual(314);
expect(statusBox?.width).toBeLessThanOrEqual(326);
```

For mobile, assert the composer bottom is above the navigation top. For tablet, record the writing canvas width before and after opening a drawer and require a difference no greater than 1px.

- [ ] **Step 3: Add accessibility coverage for tablet drawer state**

In `app.a11y.test.tsx`, render the workbench at 1024px, open the chapter drawer, and run the existing axe helper against `document.body`. Assert zero WCAG AA violations.

- [ ] **Step 4: Run the complete responsive gate**

Run:

```bash
pnpm vitest run src/web/client/workbench/workbench.test.tsx src/web/client/app.a11y.test.tsx scripts/playwright-server.test.ts
TEST_DATABASE_URL=postgres://invalid pnpm exec playwright test --project=responsive
pnpm typecheck
pnpm build
git diff --check
```

Expected:

- Focused Vitest files PASS.
- Responsive Playwright passes all project and workbench cases at six widths.
- TypeScript and production build exit 0.
- `git diff --check` produces no output.

- [ ] **Step 5: Commit final regression coverage**

```bash
git add tests/browser/webui-responsive.spec.ts src/web/client/app.a11y.test.tsx scripts/playwright-server.test.ts
git commit -m "test(webui): cover responsive workbench modes"
```

---

## Final Review Checklist

- [ ] Mobile uses a single visible task panel and defaults to writing.
- [ ] Mobile composer remains above navigation and safe-area inset.
- [ ] Tablet drawers are mutually exclusive and restore focus.
- [ ] Tablet drawers do not resize the writing canvas.
- [ ] Desktop uses stable 256px and 320px columns with collapse controls.
- [ ] Layout sliders and `LayoutControls` are fully removed.
- [ ] Existing run creation, control, answer, model switch, diagnostics, realtime, URL, and popstate tests remain green.
- [ ] Six browser widths have zero page-level horizontal overflow.
- [ ] WCAG AA, TypeScript, production build, and diff checks pass.
