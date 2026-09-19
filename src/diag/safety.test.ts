import { describe, expect, it } from "vitest";
import { scanSafety } from "./safety.js";

describe("safety 内容安全", () => {
  it("reports clean for ordinary prose", () => {
    const report = scanSafety("沈砚推开书局的门，雨声敲着屋檐。他慢慢翻开了那本旧账。");
    expect(report.clean).toBe(true);
    expect(report.hits).toEqual([]);
    expect(report.scannedChars).toBeGreaterThan(10);
  });

  it("detects builtin categories with samples", () => {
    const text = "他详细描述了自杀方法，又提到一个赌博网站的地址。";
    const report = scanSafety(text);
    expect(report.clean).toBe(false);
    const categories = report.hits.map((hit) => hit.category);
    expect(categories).toContain("selfHarm");
    expect(categories).toContain("gamblingFraud");
    expect(report.hits[0]!.samples.length).toBeGreaterThan(0);
  });

  it("supports custom patterns from the request", () => {
    const report = scanSafety("内部暗号：飞天意大利面神教", [{ category: "custom", pattern: "飞天意大利面神教" }]);
    expect(report.hits.some((hit) => hit.category === "custom" && hit.count === 1)).toBe(true);
  });

  it("skips invalid regex patterns instead of throwing", () => {
    expect(() => scanSafety("正文", [{ category: "custom", pattern: "([unclosed" }])).not.toThrow();
  });
});
