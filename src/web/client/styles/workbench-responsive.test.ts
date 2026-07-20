// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(process.cwd(), "src/web/client/styles/global.css"), "utf8");

function extractMediaBlock(condition: string, anchor: string): string {
  const marker = `@media ${condition}`;
  let searchFrom = 0;

  while (true) {
    const mediaStart = css.indexOf(marker, searchFrom);
    if (mediaStart === -1) throw new Error(`Missing ${marker} block containing ${anchor}`);
    const blockStart = css.indexOf("{", mediaStart + marker.length);
    let depth = 0;

    for (let index = blockStart; index < css.length; index += 1) {
      if (css[index] === "{") depth += 1;
      if (css[index] !== "}") continue;
      depth -= 1;
      if (depth !== 0) continue;

      const block = css.slice(blockStart + 1, index);
      if (block.includes(anchor)) return block;
      searchFrom = index + 1;
      break;
    }
  }
}

const mobile = extractMediaBlock("(max-width: 767px)", ".workbench-shell");
const tablet = extractMediaBlock("(min-width: 768px) and (max-width: 1199px)", ".workbench-tablet-toolbar");
const desktop = extractMediaBlock("(min-width: 1200px)", ".workbench-grid");
const wideDesktop = extractMediaBlock("(min-width: 1600px)", ".activity-scroll");

describe("responsive workbench CSS", () => {
  it("keeps shared overflow, reading measure, and disabled-action contracts", () => {
    expect(css).toMatch(/\.activity-scroll\s*\{(?=[^}]*min-height:\s*0)(?=[^}]*overflow:\s*auto)/);
    expect(css).toMatch(/\.event-list\s*\{[^}]*max-width:\s*46rem/);
    expect(css).toMatch(/\.activity-panel\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.activity-scroll\s*\{[^}]*grid-row:\s*2/);
    expect(css).toContain('.run-create-card button:disabled:not([aria-busy="true"]) { cursor: not-allowed; }');
    expect(css).not.toContain("@media (max-width: 768px)");
    expect(css).not.toContain(".layout-controls");
    expect(css).not.toContain(".layout-control-row");
    expect(css).not.toContain(".workbench-grid > .writing-column { grid-column: 1 / -1;");
  });

  it("defines the mobile block without crossing its media boundary", () => {
    expect(mobile).toMatch(/\.workbench-grid\s*\{[^}]*display:\s*block[^}]*height:\s*calc\(100dvh - 56px - 68px - env\(safe-area-inset-bottom\)\)/);
    expect(mobile).toMatch(/\.activity-panel\s*\{[^}]*grid-template-rows:\s*auto auto minmax\(0, 1fr\)/);
    expect(mobile).toMatch(/\.activity-scroll\s*\{[^}]*grid-row:\s*3/);
    expect(mobile).toMatch(/\.mobile-run-summary\s*\{[^}]*display:\s*flex/);
    expect(mobile).toMatch(/\.mobile-workbench-nav\s*\{(?=[^}]*bottom:\s*env\(safe-area-inset-bottom\))(?=[^}]*height:\s*68px)/);
    expect(mobile).toMatch(/\.mobile-workbench-nav svg\s*\{[^}]*flex:\s*0 0 20px/);
  });

  it("defines the tablet block without crossing its media boundary", () => {
    expect(tablet).toMatch(/\.workbench-tablet-toolbar\s*\{[^}]*height:\s*52px/);
    expect(tablet).toMatch(/\.workbench-grid\s*\{[^}]*display:\s*block[^}]*height:\s*calc\(100dvh - 58px - 52px\)/);
    expect(tablet).toMatch(/\.workbench-grid > \[data-panel="project"\], \.workbench-grid > \[data-panel="status"\]\s*\{[^}]*display:\s*none/);
    expect(tablet).toMatch(/\.workbench-grid > \.writing-column\s*\{[^}]*height:\s*100%/);
    expect(tablet).toMatch(/\.workbench-drawer-layer\s*\{(?=[^}]*position:\s*fixed)(?=[^}]*top:\s*110px)(?=[^}]*bottom:\s*0)/);
    expect(tablet).toMatch(/\.workbench-drawer-backdrop\s*\{(?=[^}]*position:\s*absolute)(?=[^}]*inset:\s*0)/);
    expect(tablet).toMatch(/\.workbench-drawer\s*\{(?=[^}]*position:\s*absolute)(?=[^}]*overflow:\s*auto)(?=[^}]*max-width:\s*min\(78vw, 360px\))/);
    expect(tablet).toMatch(/\.workbench-drawer-left\s*\{[^}]*left:\s*0/);
    expect(tablet).toMatch(/\.workbench-drawer-right\s*\{[^}]*right:\s*0/);
  });

  it("defines stable desktop columns and desktop-only visibility", () => {
    expect(desktop).toMatch(/\.workbench-grid\s*\{[^}]*grid-template-columns:\s*256px minmax\(0, 1fr\) 320px/);
    expect(desktop).toMatch(/\.workbench-grid\.left-closed\s*\{[^}]*grid-template-columns:\s*56px minmax\(0, 1fr\) 320px/);
    expect(desktop).toMatch(/\.workbench-grid\.right-closed\s*\{[^}]*grid-template-columns:\s*256px minmax\(0, 1fr\) 56px/);
    expect(desktop).toMatch(/\.workbench-grid\.left-closed\.right-closed\s*\{[^}]*grid-template-columns:\s*56px minmax\(0, 1fr\) 56px/);
    expect(desktop).toMatch(/\.mobile-workbench-nav, \.workbench-tablet-toolbar, \.workbench-drawer-layer, \.mobile-run-summary\s*\{[^}]*display:\s*none/);
  });

  it("adds wide-desktop reading space inside the 1600px block", () => {
    expect(wideDesktop).toMatch(/\.activity-scroll\s*\{[^}]*padding-inline:\s*clamp\(4rem, 8vw, 9rem\)/);
  });
});
