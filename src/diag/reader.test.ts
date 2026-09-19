import { describe, expect, it } from "vitest";
import { adversarialReview, extractNameCandidates, readerScore } from "./reader.js";

const HOT = "他猛然拔刀，血光冲天。杀意如潮水般涌来，这是生死一战！赢了，他终于赢了，全场震惊。突然，一道黑影从钟楼顶端扑下——";
const FLAT = "今天天气很好。他走出门，看了看街道。街道上有些人。他买了早餐，慢慢吃完。然后他回家了。他坐了一会儿，又站起来看了看窗外。";

describe("reader 读者模拟", () => {
  it("scores hot text higher than flat text", () => {
    const hot = readerScore(HOT)!;
    const flat = readerScore(FLAT)!;
    expect(hot.score).toBeGreaterThan(flat.score);
    expect(hot.dimensions.thrill).toBeGreaterThan(flat.dimensions.thrill);
    expect(hot.dimensions.hook).toBeGreaterThan(0);
    expect(flat.dimensions.dialogue).toBeLessThan(hot.dimensions.dialogue + 100);
  });

  it("returns null for blank text", () => {
    expect(readerScore("   ")).toBeNull();
  });

  it("extracts recurring name candidates", () => {
    const text = "沈砚抬头。沈砚笑了。沈砚转身离开。路人看着沈砚的背影。";
    expect(extractNameCandidates(text)).toContain("沈砚");
  });

  it("adversarial review flags flat runs and drift names", () => {
    const report = adversarialReview(
      [
        { chapter: 1, title: "一", text: FLAT },
        { chapter: 2, title: "二", text: FLAT },
        { chapter: 3, title: "三", text: HOT, aitoneScore: 50 },
      ],
      ["沈砚"],
    );
    expect(report.chapters).toHaveLength(3);
    expect(report.findings.some((finding) => finding.attack === "flat")).toBe(true);
    expect(report.findings.some((finding) => finding.attack === "aitone" && finding.chapter === 3)).toBe(true);
    expect(report.findings.some((finding) => finding.attack === "entityDrift")).toBe(false);
  });

  it("flags entity drift for unregistered recurring names", () => {
    const text = HOT + " 顾长风冷笑。顾长风再次出手。顾长风消失了。";
    const report = adversarialReview([{ chapter: 1, title: "一", text }], []);
    expect(report.findings.some((finding) => finding.attack === "entityDrift" && finding.evidence.includes("顾长风"))).toBe(true);
  });

  it("returns empty report when no chapter text", () => {
    expect(adversarialReview([{ chapter: 1, title: "一", text: "" }], [])).toEqual({ chapters: [], findings: [], averageScore: 0 });
  });
});
