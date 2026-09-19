import { describe, expect, it } from "vitest";
import { goldenReview } from "./golden.js";

const STRONG = "沈砚推开书局的门。“这么晚还来？”苏晚问。他没答话，把湿透的外套挂在门后。雨声敲着屋檐，灯光昏黄。他忽然想起十年前的雨夜——父亲就是从这扇门走出去，再也没有回来。桌上摆着四只茶杯，屋里却只有三个人。";
const WEAK = "据说这个镇子很有历史。原来很久以前这里有一座山，山里有很多人，多年以前他们过着平静的生活。这里的故事要从一个很长的背景说起，历史沿革复杂，人口变迁频繁，经济以农业为主，手工业为辅。";

describe("golden 黄金三章诊断", () => {
  it("scores a strong opening higher than a weak one", () => {
    const strong = goldenReview([{ chapter: 1, text: STRONG }]);
    const weak = goldenReview([{ chapter: 1, text: WEAK }]);
    expect(strong.chapters[0]!.score).toBeGreaterThan(weak.chapters[0]!.score);
    expect(strong.chapters[0]!.dimensions.openingHook).toBeGreaterThan(weak.chapters[0]!.dimensions.openingHook);
    expect(strong.chapters[0]!.dimensions.immersion).toBeGreaterThan(weak.chapters[0]!.dimensions.immersion);
    expect(strong.chapters[0]!.dimensions.infoDump).toBeGreaterThan(weak.chapters[0]!.dimensions.infoDump);
  });

  it("flags weak dimensions as findings and labels missing chapters", () => {
    const report = goldenReview([{ chapter: 1, text: WEAK }]);
    expect(report.reviewed).toBe(1);
    expect(report.missing).toEqual([2, 3]);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.verdict).not.toBe("开局合格");
  });

  it("returns empty report with verdict when no chapters", () => {
    const report = goldenReview([]);
    expect(report.reviewed).toBe(0);
    expect(report.missing).toEqual([1, 2, 3]);
    expect(report.chapters).toEqual([]);
    expect(report.verdict).toContain("暂无可评审章节");
  });
});
