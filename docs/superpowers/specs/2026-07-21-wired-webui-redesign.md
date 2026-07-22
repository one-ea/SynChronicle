# Wired WebUI Redesign

## Goal

将 SynChronicle WebUI 从当前暖色调紫色编辑室风格全面切换为 Wired 杂志品牌的黑白极简风格，严格遵循 `docs/design/wired.md` 中的 design token 体系。

## Scope

- 重定义 `tokens.css` 中所有 CSS 自定义属性为 Wired 值
- 调整 `global.css` 中所有使用旧 token（紫色系、圆角、阴影）的样式
- 工作台响应式三栏布局、抽屉行为、移动导航结构不变
- 项目列表、登录、设置页同步适配

## Out of Scope

- Tailwind 引入
- JSX/组件结构改动
- 新页面、新组件
- 响应式断点和布局逻辑变更

## Design Tokens

### Fonts

| Token | Wired Value |
|-------|-------------|
| `--font-display` | "Playfair Display", Georgia, serif |
| `--font-body` | "Inter", system-ui, sans-serif |
| `--font-editorial` | "Lora", Georgia, serif |

Font import: Playfair Display (400,700), Inter (400,700), Lora (400,700)

### Colors

| Token | Wired Value | Role |
|-------|-------------|------|
| `--ink` | #000000 | Headlines, CTAs, primary text |
| `--ink-muted` | #1a1a1a | Footer links, caption emphasis |
| `--ink-body` | #757575 | Byline, timestamp, secondary metadata |
| `--paper` | #ffffff | Default page background |
| `--paper-raised` | #f5f5f5 | Comment areas, hover rows, secondary surfaces |
| `--rule` | #e0e0e0 | Hairline 1px dividers, input borders |
| `--link` | #057dbc | Inline body links only |
| `--focus` | #000000 | Focus ring outline color |
| `--danger` | #9b2c2c | Functional error/danger (preserved) |
| `--accent` | #000000 | Replaces `--purple` / `--purple-dark` |

Removed tokens: `--purple`, `--purple-dark`, `--purple-pale`

New tokens: `--link`, `--ink-body`, `--accent`, `--font-editorial`, `--hairline` (= 1px solid var(--rule)), `--radius` (= 0px)

### Shapes

- `--radius`: 0px — all buttons, inputs, cards use sharp corners
- No drop-shadows; elevation via hairline borders or heavy black borders (2px)
- `--hairline`: 1px solid var(--rule)

### Spacing

Existing spacing tokens (`--space-1` to `--space-8`, `--measure`) unchanged.

## Component Restyling

| Component | Change |
|-----------|--------|
| `h1, h2` | `--font-display` Playfair 700; weight 600→700 |
| `.eyebrow` | Color from `--purple-dark` to `--ink`; Inter 700 |
| `.button-primary` | Background `--ink`, text white, border-radius 0 |
| `.button-primary:hover` | Background `--ink-muted` |
| `.button-secondary` | Border-color `--ink`, color `--ink`, border-radius 0 |
| `.button-danger` | border-radius 0 (color preserved) |
| `.text-button` | Color `--link`, underline |
| `.icon-button` | border-color `--rule`, hover background `--paper-raised` |
| `.icon-button:hover` | background `--paper-raised`, border-color `--ink` |
| `.wordmark` | `--font-display` Playfair 700, color `--ink` |
| `.nav-current` | Color `--ink`, font-weight 700, border-bottom 2px `--ink` |
| `.site-header` | border-bottom `--hairline` |
| `input` | border 1px solid var(--rule), border-radius 0, bg `--paper` |
| `.project-list` | border-top 2px solid var(--ink) |
| `.project-row` | border-bottom `--hairline`, min-height 96px |
| `.project-index` | Color `--ink`, `--font-display` |
| `.project-copy h2 a:hover` | Color `--link`, underline |
| `.message-error` | border-left 3px solid var(--danger), bg `--paper-raised` |
| `.dialog` | border-top 2px solid var(--ink) |
| `.dialog-backdrop` | background rgba(0,0,0,0.58) |
| `.loader` | Background `--ink` |
| `:focus-visible` | outline-color `--ink` |

## Page-Level Adaptations

### Login Page

- `.login-intro`: background `--paper`, border-right `--hairline`
- `.login-intro blockquote`: border-left color `--ink` (was `--purple`)
- `.login-panel`: background `--paper-raised`

### Projects Page

- Colors follow component rules above
- Hover states use `--link` for links, `--ink` for structural elements
- `.page-heading h1` stays large display hero

### Settings Page

- `.settings-card`: background `--paper-raised`, border `--hairline`
- Form inputs: square corners per component rules

### Workbench

- Top bar: `background #000` (Wired footer band), white text/wordmark
- Chapter rail: active indicator from `--purple-dark` to left border 2px `--ink`
- Right panel cards: replace shadow with `--hairline` border
- Run status cards: `--hairline` border, no shadow
- Desktop sidebars: collapsed state keeps icon + key numbers
- Mobile nav: active pill from purple to black
- Body text area: `--font-editorial` (Lora) for creative writing zone

## Responsive Behavior

No changes to breakpoints (320-767 / 768-1199 / 1200+) or layout structure. Only visual tokens change.

## Success Criteria

1. Zero `--purple`, `--purple-dark`, `--purple-pale` references in CSS after migration
2. All buttons/inputs/cards render at 0px border-radius
3. Playfair Display, Inter, Lora loaded and applied to correct roles
4. Existing responsive Playwright tests (16/16) pass with no layout breakage
5. TypeScript typecheck clean, Vite build successful
6. No JSX/TSX files changed

## Non-Goals

- Tailwind CSS integration
- New components or pages
- Dark mode
- Wired masthead-band component (out of scope for this pass)
