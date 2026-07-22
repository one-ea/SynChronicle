# Wired WebUI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin SynChronicle WebUI from purple-serif editorial to Wired black/white magazine style by rewriting CSS tokens and component styles, zero JSX changes.

**Architecture:** Rewrite `tokens.css` with Wired design tokens (fonts, colors, shapes), then update `global.css` component selectors to use new tokens and remove purple/radius/shadow patterns. Existing responsive layout and JSX unchanged.

**Tech Stack:** CSS custom properties, Google Fonts, Vite.

## Global Constraints

- Node.js 24 LTS, pnpm 10, TypeScript strict, ESM.
- Two CSS files modified only: `src/web/client/styles/tokens.css`, `src/web/client/styles/global.css`.
- Zero JSX/TSX changes.
- Zero new dependencies.
- Existing responsive Playwright tests (16/16) must pass.
- Existing Vitest tests must stay green.
- Typecheck + build must succeed.
- TDD for CSS contract tests.

## File Structure

```
src/web/client/styles/
  tokens.css                 (MODIFY) — fonts, colors, shapes to Wired values
  global.css                 (MODIFY) — component selectors to use new tokens
  workbench-responsive.test.ts (MODIFY) — update expected values if tokens referenced
```

---

### Task 1: Rewrite CSS Design Tokens

**Files:**
- Modify: `src/web/client/styles/tokens.css`

**Interfaces:**
- Produces: CSS custom properties matching Wired spec

- [ ] **Step 1: Write the failing CSS contract test**

Add to `src/web/client/styles/workbench-responsive.test.ts`:

```typescript
it("defines Wired design tokens with correct values", () => {
  const style = getComputedStyle(document.documentElement);
  expect(style.getPropertyValue("--ink").trim()).toBe("#000000");
  expect(style.getPropertyValue("--paper").trim()).toBe("#ffffff");
  expect(style.getPropertyValue("--rule").trim()).toBe("#e0e0e0");
  expect(style.getPropertyValue("--link").trim()).toBe("#057dbc");
  expect(style.getPropertyValue("--font-display")).toContain("Playfair Display");
  expect(style.getPropertyValue("--font-body")).toContain("Inter");
  expect(style.getPropertyValue("--font-editorial")).toContain("Lora");
  expect(style.getPropertyValue("--radius").trim()).toBe("0px");
  expect(style.getPropertyValue("--accent").trim()).toBe("#000000");
  // Verify purple tokens are gone
  expect(style.getPropertyValue("--purple").trim()).toBe("");
  expect(style.getPropertyValue("--purple-dark").trim()).toBe("");
  expect(style.getPropertyValue("--purple-pale").trim()).toBe("");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/web/client/styles/workbench-responsive.test.ts --pool=threads
```
Expected: new test FAILs.

- [ ] **Step 3: Rewrite tokens.css**

```css
@import url("https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Inter:wght@400;700&family=Lora:wght@400;700&display=swap");

:root {
  --font-display: "Playfair Display", Georgia, serif;
  --font-body: "Inter", system-ui, sans-serif;
  --font-editorial: "Lora", Georgia, serif;
  --ink: #000000;
  --ink-muted: #1a1a1a;
  --ink-body: #757575;
  --paper: #ffffff;
  --paper-raised: #f5f5f5;
  --rule: #e0e0e0;
  --link: #057dbc;
  --focus: #000000;
  --danger: #9b2c2c;
  --accent: #000000;
  --radius: 0px;
  --hairline: 1px solid var(--rule);
  --space-1: 0.5rem;
  --space-2: 1rem;
  --space-3: 1.5rem;
  --space-4: 2rem;
  --space-6: 3rem;
  --space-8: 4rem;
  --measure: 72rem;
  --motion: 180ms ease;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run src/web/client/styles/workbench-responsive.test.ts --pool=threads
```
Expected: 7/7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/client/styles/tokens.css src/web/client/styles/workbench-responsive.test.ts
git commit -m "feat(webui): apply Wired design tokens to stylesheet"
```

---

### Task 2: Restyle Components with New Tokens

**Files:**
- Modify: `src/web/client/styles/global.css`

**Interfaces:**
- Consumes: Wired tokens from Task 1
- Produces: All component selectors use only Wired tokens, zero purple/radius references

- [ ] **Step 1: Update global.css component styles**

Replace every occurrence:
- `var(--purple-dark)` → `var(--ink)` (buttons, eyebrow, project-index, nav-current, dialog border-top, text-button)
- `var(--purple)` → `var(--accent)` (links, hover states)
- `var(--purple-pale)` → `var(--paper-raised)` (.login-intro background, .icon-button:hover background)
- `var(--ink)` → `var(--ink)` (already correct for .project-list border-top, .project-copy h2, .wordmark)
- `var(--rule)` → `var(--rule)` (already correct, value just changed)
- All `border-radius: Xpx` on buttons/inputs → `var(--radius)` or `0`
- All `box-shadow` → removed, replace with `var(--hairline)` border
- `.login-intro blockquote` border-left: `var(--purple)` → `var(--ink)`
- `.dialog-backdrop` background: `rgb(33 29 36 / 58%)` → `rgba(0,0,0,0.58)`
- `.nav-current` → add `border-bottom: 2px solid var(--ink)`
- `.icon-button:hover` → `background: var(--paper-raised); border-color: var(--ink)`

Exact edits (in order):

```css
/* .eyebrow */
.eyebrow, .section-number { color: var(--ink); ... }
```

```css
/* .button-primary */
.button-primary { background: var(--ink); color: var(--paper); border-radius: var(--radius); }
.button-primary:hover { background: var(--ink-muted); }
```

```css
/* .button-secondary */
.button-secondary { background: transparent; border-color: var(--ink); color: var(--ink); border-radius: var(--radius); }
```

```css
/* .text-button */
.text-button { color: var(--link); ... }
```

```css
/* .icon-button */
.icon-button { border: var(--hairline); border-radius: var(--radius); }
.icon-button:hover { background: var(--paper-raised); border-color: var(--ink); }
```

```css
/* .login-intro */
.login-intro { background: var(--paper); border-bottom: var(--hairline); }
.login-intro blockquote { border-left: 3px solid var(--ink); ... }
```

```css
/* .login-panel */
.login-panel { background: var(--paper-raised); }
```

```css
/* .dialog */
.dialog { border-top: 4px solid var(--ink); }
```

```css
/* .dialog-backdrop */
.dialog-backdrop { background: rgba(0,0,0,0.58); }
```

```css
/* .loader */
.loader { background: var(--ink); }
```

```css
/* .project-index */
.project-index { color: var(--ink); ... }
```

```css
/* .project-copy h2 a:hover */
.project-copy h2 a:hover { color: var(--link); ... }
```

```css
/* .nav-current */
.nav-current { color: var(--ink); font-weight: 700; border-bottom: 2px solid var(--ink); }
```

```css
/* .import-progress */
.import-progress progress { accent-color: var(--ink); }
```

```css
/* h1, h2 */
h1, h2 { font-family: var(--font-display); font-weight: 700; ... }
```

```css
/* input */
input { border: var(--hairline); border-radius: var(--radius); background: var(--paper); }
```

```css
/* .message-error */
.message-error { background: var(--paper-raised); border-left: 3px solid var(--danger); color: var(--ink); }
```

```css
/* .project-row */
.project-row { border-bottom: var(--hairline); min-height: 96px; ... }
```

```css
/* :focus-visible */
:focus-visible { outline-color: var(--focus); ... }
```

```css
/* .icon-button svg */
.icon-button svg { ... stroke-width: 1.7; ... }
```

```css
/* ensure body & workbench body use editorial font for creative area */
body { color: var(--ink); }
```

- [ ] **Step 2: Verify no purple references remain**

```bash
rg "purple" src/web/client/styles/global.css src/web/client/styles/tokens.css
```
Expected: zero matches in global.css; zero in tokens.css.

- [ ] **Step 3: Run CSS contract tests**

```bash
pnpm vitest run src/web/client/styles/workbench-responsive.test.ts --pool=threads
```
Expected: 7/7 (or more) PASS.

- [ ] **Step 4: Commit**

```bash
git add src/web/client/styles/global.css
git commit -m "feat(webui): restyle components to Wired black/white editorial"
```

---

### Task 3: Full Verification Gate

**Files:** (none modified)

- [ ] **Step 1: Run unit tests**

```bash
pnpm vitest run --pool=threads --maxWorkers=1
```
Expected: 700+ tests PASS (excluding pre-existing thread-pool issues).

- [ ] **Step 2: Run responsive Playwright**

```bash
TEST_DATABASE_URL=postgres://invalid pnpm exec playwright test --project=responsive
```
Expected: 16/16 PASS.

- [ ] **Step 3: Typecheck and build**

```bash
pnpm typecheck && pnpm build
```
Expected: both succeed.

- [ ] **Step 4: Git diff check**

```bash
git diff --check
```
Expected: clean.

- [ ] **Step 5: Commit progress**

```bash
git add .superpowers/sdd/progress.md
git commit -m "docs(sdd): record Wired WebUI redesign verification"
```

- [ ] **Step 6: Push**

```bash
git push origin 260715-feat-multi-user-webui
```
