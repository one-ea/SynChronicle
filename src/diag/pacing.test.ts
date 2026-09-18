import { describe, expect, it } from "vitest";
import { PACING_LIMITS, pacingFindings } from "./pacing.js";
import type { Progress } from "../domain/index.js";

function progress(overrides: Partial<Progress>): Progress {
  return {
    novel_name: "测试", phase: "writing", current_chapter: 10, total_chapters: 20,
    completed_chapters: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], total_word_count: 30000,
    ...overrides,
  } as Progress;
}

describe("pacingFindings", () => {
  it("returns nothing when strand history is missing or too short", () => {
    expect(pacingFindings(progress({ strand_history: [] }))).toEqual([]);
    expect(pacingFindings(progress({ strand_history: ["主线"] }))).toEqual([]);
  });

  it("flags a mainline run longer than the limit", () => {
    const history = ["支线", "主线", "主线", "主线", "主线", "主线", "主线"];
    const findings = pacingFindings(progress({ strand_history: history }));
    const rule = findings.find((finding) => finding.rule === "PacingStall.mainline_run");
    expect(rule?.severity).toBe("warning");
    expect(rule?.evidence).toContain(`已连续 ${PACING_LIMITS.mainlineRun + 1} 章`);
  });

  it("keeps silence when the mainline run stays within the limit", () => {
    const history = ["主线", "支线", "主线", "主线", "支线"];
    expect(pacingFindings(progress({ strand_history: history }))).toEqual([]);
  });

  it("flags a strand absent longer than the limit", () => {
    const history = ["感情", "主线", "主线", "主线", "主线", "主线", "主线", "主线", "主线", "主线", "主线", "主线"];
    const findings = pacingFindings(progress({ strand_history: history }));
    const rule = findings.find((finding) => finding.rule === "PacingStall.strand_absence");
    expect(rule?.evidence).toContain("感情");
    expect(rule?.evidence).toContain("未推进");
  });

  it("flags an overall stall when completed chapters lack strand records", () => {
    const completed = Array.from({ length: 20 }, (_unused, index) => index + 1);
    const findings = pacingFindings(progress({ completed_chapters: completed, current_chapter: 20, strand_history: ["主线", "支线"] }));
    const rule = findings.find((finding) => finding.rule === "PacingStall.overall_stall");
    expect(rule?.evidence).toContain("缺少叙事线记录");
  });

  it("produces warning severity only", () => {
    const findings = pacingFindings(progress({ strand_history: Array.from({ length: 20 }, () => "主线") }));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.severity === "warning")).toBe(true);
  });
});
