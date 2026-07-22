# README Editorial Redesign

- Date: 2026-07-22
- Status: Approved
- Scope: `README.md` and one repository-hosted WebUI screenshot

## Goal

Turn the repository README into a product-homepage-style introduction that helps creators understand SynChronicle quickly while preserving clear installation, operation, and development paths for contributors.

## Audience

The primary audience is creators and evaluators encountering SynChronicle for the first time. Developers and operators remain a secondary audience served by concise technical sections and links to deeper documentation.

## Visual Direction

The README will extend the WebUI's Wired-inspired editorial language within GitHub Markdown constraints:

- Centered product name and concise value proposition.
- A restrained set of status and technology badges.
- Short navigation links for fast scanning.
- Strong black-and-white product imagery from the real WebUI.
- Compact tables, callouts, and diagrams in place of long explanatory blocks.
- No decorative assets that imply features absent from the repository.

## Information Architecture

The README will use the following order:

1. Hero: product name, positioning, badges, and navigation.
2. Product screenshot: current responsive WebUI workbench.
3. Product value: the problems SynChronicle solves.
4. Core capabilities: multi-agent creation, resumability, observability, model configuration, multi-user WebUI, and long-context project state.
5. Multi-agent workflow: Mermaid diagram showing Coordinator, Architect, Writer, Editor, and Store responsibilities.
6. Five-minute start: prerequisites, installation, minimal provider configuration, and first run.
7. Web platform: Web, Worker, PostgreSQL, health checks, and container startup.
8. CLI workflow: interactive and headless examples.
9. Output structure: readable local artifacts and checkpoints.
10. Architecture: TypeScript, Fastify, React, Worker, PostgreSQL, Drizzle, and provider adapters.
11. Development: pnpm commands for build, typecheck, unit tests, and browser tests.
12. Documentation, security, contribution, and GPL-3.0-only license links.

The target length is 180-230 lines. Advanced provider networking, deployment recovery, and internal runtime details will remain in dedicated documents.

## Screenshot

Create `docs/assets/webui-workbench.png` from the current running WebUI using the repository's responsive workbench at a desktop viewport. The image must:

- Show the real application rather than a fabricated mockup.
- Use representative demo data without credentials or personal information.
- Capture the Wired black-and-white visual system and three-column workbench.
- Remain readable when rendered at the README content width.

The README will reference the image with a repository-relative path.

## Content Rules

- Use `# SynChronicle` as the document title.
- Position the product as a multi-agent AI long-form writing engine.
- Describe only behavior supported by current code, tests, configuration, or operational documentation.
- Use `synchronicle` for CLI examples and pnpm for repository development commands.
- Require Node.js 24 or later.
- Use placeholders for provider credentials and user-managed configuration.
- Keep `GPL-3.0-only`, the copyright notice, and links to `LICENSE` and `NOTICE` accurate.
- Keep Mermaid labels on one line and quote labels containing special characters.
- Avoid excessive badges, collapsible sections, generated statistics, and maintenance-heavy marketing claims.
- Avoid references to removed historical screenshots and stale Go implementation paths.

## Verification

The implementation is complete when:

1. `README.md` follows the approved information architecture and target length.
2. Every repository-relative README link resolves to an existing path.
3. Installation, development, deployment, and test commands match repository scripts and operational documentation.
4. The screenshot exists, is a valid PNG, and contains no credentials.
5. Mermaid syntax uses single-line labels and quoted special characters.
6. `pnpm typecheck`, `pnpm build`, relevant documentation or brand tests, and `git diff --check` pass.
7. The README renders coherently on desktop and remains scan-friendly on narrow GitHub layouts.

## Out of Scope

- Product behavior or source-code changes.
- A new logo or standalone brand identity system.
- Full project wiki regeneration.
- Translating the README into additional languages.
- Publishing generated screenshots to an external image host.
