# Task 9 Report

## Status

Implemented the React/Vite application shell, cookie-session authentication flow, and active project management UI. Fastify serves the production client and returns the SPA entry point for browser routes while preserving API and WebSocket 404 behavior.

## RED / GREEN

- RED: `src/web/client/app.test.tsx` and `app.a11y.test.tsx` failed because the React application did not exist.
- GREEN: login, cookie-session restoration, logout, project loading, creation, optimistic rename, archive, 409 rollback feedback, uniform authentication errors, request IDs, empty/error/loading states, keyboard focus, and WCAG AA axe checks pass.
- RED: the Fastify browser-route test returned 404 because the static root resolved to the TypeScript source directory.
- GREEN: Fastify resolves `dist/web/client`, serves built assets, and returns `index.html` for `/login` and other non-API browser routes.

## Design System

- Direction: AI-native literary editorial with content-led hierarchy, restrained rules, paper surfaces, and a single purple accent family.
- Typography: Cormorant Garamond for display and Libre Baskerville for body copy, with serif fallbacks and `font-display` behavior supplied by Google Fonts CSS.
- Components use editorial rows and typographic hierarchy instead of repeated gradient cards.
- Icons are inline monochrome SVG with consistent stroke treatment; the UI contains no emoji icons.

## Responsive And Accessibility

- Mobile-first rules cover 375, 768, 1024, and 1440 widths with adaptive gutters, stacked mobile actions, split login layout at desktop widths, and no fixed-width content overflow.
- Native forms, visible labels, autocomplete metadata, semantic headings, skip link, nav landmarks, dialog semantics, live loading text, and alert regions support keyboard and assistive technology use.
- Interactive controls have at least 44px targets, visible focus rings, AA-oriented color tokens, and `prefers-reduced-motion` overrides.
- Axe WCAG 2 A/AA test reports zero detectable violations on the login page.

## API And Security

- The centralized client sends same-origin credentials and per-request `x-request-id`, reads response request IDs, and classifies 401, 403, 409, network, and general request failures.
- Browser JavaScript stores no session token. Session restoration uses the protected project-list endpoint and the HttpOnly cookie managed by Fastify.
- State-changing requests remain same-origin so the browser supplies the Origin used by the existing server CSRF check.

## Self Review

- Scope remains limited to authentication and project management; Task 10 workbench components and realtime UI are absent.
- Rename and archive update the list optimistically and restore the previous list after API failure. Conflict messages identify concurrent modification and include the server request ID.
- Project list state represents active projects only, matching the repository's archive filter.
- Production build order keeps the server bundle and Vite assets together under `dist/web`.

## Verification

Task 9 的历史计数已由 Task 15 全量发布门禁取代。当前准确结果记录在 `task-15-report.md`，避免在阶段报告中维护重复且易漂移的测试总数。

## Concerns

- PostgreSQL-conditional tests remain skipped without `TEST_DATABASE_URL`, consistent with prior task reports.
- Session restoration infers authentication through `/api/projects/`; a future dedicated session endpoint can restore display identity without coupling shell startup to project availability.
- Google Fonts require network access; Georgia fallbacks preserve the literary layout when font delivery is unavailable.
- Fastify production静态目录相对已打包 Web 入口解析；测试通过显式 `staticRoot` 使用隔离 fixture。

## Hardening Follow-up

### RED / GREEN

- RED: failed logout cleared the local session in `finally` and produced an unhandled rejection. GREEN: only a 204 response clears state; failures retain the project page and expose a request-ID-bearing retry action.
- RED: rename and archive restored a captured whole-list snapshot, dropping a project created while the mutation was pending. GREEN: functional target-level updates and per-project mutation tokens preserve unrelated and newer state.
- RED: the static route test consumed residual `dist` output and the server resolved assets from `process.cwd()`. GREEN: tests create an isolated temporary fixture and inject its root; production defaults to the client directory beside the bundled server module.
- RED: Fastify discarded valid client correlation IDs. GREEN: valid UUID request IDs flow through responses, audit calls, and logs; malformed values are replaced with a generated UUID.
- RED: login rendered every failure as invalid credentials. GREEN: 401, 429, network, and server failures have distinct recovery messages, with retry labeling for transient failures.
- RED: the modal lacked inert background, Escape handling, and focus containment. GREEN: modal focus initializes inside the dialog, wraps on Tab, closes on Escape, restores its trigger, and marks background content inert and hidden from assistive technology.
- RED: custom development ports diverged between Vite, Fastify, and `PUBLIC_URL`. GREEN: `dev:web` derives the Vite port and proxy backend from one environment configuration and supervises all child processes without another runtime dependency.

### Accessibility And Responsive Verification

- The project page and open modal pass axe WCAG 2 A/AA checks in jsdom.
- Keyboard tests cover initial modal focus, reverse-tab containment, Escape dismissal, and trigger focus restoration.
- Playwright runs Chromium at 375, 768, 1024, and 1440 pixels, asserting visible navigation, no horizontal overflow, and 44px minimum button bounds.

### Development And Static Serving

- `pnpm dev:web` performs an initial server build, starts tsup watch, Fastify watch, and Vite, and shuts sibling processes down when one exits.
- A live smoke run started Fastify on 3000 and Vite on 5173; `/api/health` returned 200 through the Vite proxy with `PUBLIC_URL=http://localhost:5173`.
- Vite retains `/api` and `/ws` proxying and accepts `VITE_BACKEND_URL` from the supervisor for custom backend ports.

### Updated Concerns

- PostgreSQL-conditional tests still require `TEST_DATABASE_URL` and remain skipped in the local full suite.
- Playwright Chromium and its Linux runtime libraries must be installed in CI before `pnpm test:browser`; this environment was provisioned with Playwright's official install commands.
- Session restoration continues to infer authentication through `/api/projects/`; a dedicated session endpoint remains a future decoupling opportunity.
- Google Fonts still use network delivery with Georgia fallbacks.

### Final Hardening Gate

Task 9 范围的组件、无障碍和响应式验证保持通过；跨任务总门禁统一以 `task-15-report.md` 为准。
