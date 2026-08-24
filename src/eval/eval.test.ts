import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { aggregate, grade, loadCases, type EvalCase } from "./index.js";

describe("eval", () => {
  it("loads and validates cases", () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-"));
    writeFileSync(join(dir, "a.json"), JSON.stringify({ id: "safe_case", category: "smoke", prompt: "x", max_chapters: 1, expect: {}, gate: {} }));
    expect(loadCases(dir)[0]?.gate.maxSeverity).toBe("warning");
    writeFileSync(join(dir, "b.json"), JSON.stringify({ id: "../bad", prompt: "x", expect: {}, gate: {} }));
    expect(() => loadCases(dir)).toThrow(/非法/);
  });

  it("parses phase-4 fields: target prompts, rubric, resume, seed, steer", () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-p4-"));
    writeFileSync(join(dir, "c.json"), JSON.stringify({
      id: "crash_resume",
      category: "recovery",
      role: "writer",
      description: "恢复",
      prompt: "x",
      max_chapters: 5,
      target_prompts: ["writer.md", "editor.md"],
      rubric: "writer_chapter",
      expect: {
        min_completed_chapters: 3,
        resume_to_chapters: 3,
        min_chapter_summaries: 3,
        min_arc_summaries: 1,
        min_reviews: 1,
        seed: { in_progress_chapter: 1, pending_commit: true, pending_steer: "更暗" },
        steer: { after_chapters: 2, message: "配角动机要更清晰" },
        no_pending: ["in_progress"],
      },
      gate: { max_severity: "info", stylestat_regression: "block" },
    }));
    const c = loadCases(dir)[0]!;
    expect(c.category).toBe("recovery");
    expect(c.role).toBe("writer");
    expect(c.targetPrompts).toEqual(["writer.md", "editor.md"]);
    expect(c.rubric).toBe("writer_chapter");
    expect(c.expect.resumeToChapters).toBe(3);
    expect(c.expect.minChapterSummaries).toBe(3);
    expect(c.expect.seed).toEqual({ inProgressChapter: 1, pendingCommit: true, pendingSteer: "更暗" });
    expect(c.expect.steer).toEqual({ afterChapters: 2, message: "配角动机要更清晰" });
    expect(c.gate.maxSeverity).toBe("info");
    expect(c.gate.stylestatRegression).toBe("block");
  });

  it("rejects unknown categories, bad resume_to_chapters and steer without resume", () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-bad-"));
    writeFileSync(join(dir, "x.json"), JSON.stringify({ id: "x1", category: "nightly", prompt: "x", max_chapters: 1, expect: {}, gate: {} }));
    expect(() => loadCases(dir)).toThrow(/category/);
    writeFileSync(join(dir, "x.json"), JSON.stringify({ id: "x2", category: "recovery", prompt: "x", max_chapters: 1, expect: { resume_to_chapters: 1 }, gate: {} }));
    expect(() => loadCases(dir)).toThrow(/resume_to_chapters 必须 ≥ 2/);
    writeFileSync(join(dir, "x.json"), JSON.stringify({ id: "x3", category: "steering", prompt: "x", max_chapters: 1, expect: { steer: { after_chapters: 2, message: "m" } }, gate: {} }));
    expect(() => loadCases(dir)).toThrow(/steer 需要 resume_to_chapters/);
  });

  it("loads all bundled case manifests across categories", () => {
    const all = loadCases("evals/cases");
    const byCategory = new Map<string, string[]>();
    for (const c of all) {
      byCategory.set(c.category, [...(byCategory.get(c.category) ?? []), c.id]);
    }
    expect(byCategory.get("smoke")).toEqual(expect.arrayContaining(["architect_long", "architect_short", "writer_first_chapter"]));
    expect(byCategory.get("longform")).toEqual(expect.arrayContaining(["writer_five_chapters", "arc_end_review", "context_compression"]));
    expect(byCategory.get("recovery")).toEqual(expect.arrayContaining(["crash_resume", "draft_interrupt_resume"]));
    expect(byCategory.get("steering")).toEqual(expect.arrayContaining(["steer_resume"]));
  });

  it("grades deterministic contracts and aggregates", () => {
    const c: EvalCase = { id: "x", category: "smoke", prompt: "x", maxChapters: 1, expect: { phase: "writing", minCompletedChapters: 1, requiredCheckpoints: ["chapter:1:commit"], noPending: ["pending_commit", "in_progress"] }, gate: { maxSeverity: "warning", maxCostDeltaRatio: .3, maxToolCallDeltaRatio: .3, stylestatRegression: "warn" } };
    const result = grade(c, { dir: "x", stats: { completedChapters: 1, phase: "writing" }, findings: [], checkpoints: ["chapter:1:commit"], pending: { in_progress: false, pending_commit: false }, loadErrors: [] });
    expect(result.outcome).toBe("PASS");
    expect(aggregate("r", "single", "", 1, [{ caseId: "x", category: "smoke", outcome: "WARN", runs: [], deltas: [], summary: { passRate: 0, hardFailRuns: 0, warningRuns: 1 } }]).gate).toBe("WARN");
  });

  it("fails on pending residue and finding severity beyond gate", () => {
    const c: EvalCase = { id: "y", category: "recovery", prompt: "x", maxChapters: 1, expect: { noPending: ["in_progress"] }, gate: { maxSeverity: "info", maxCostDeltaRatio: .3, maxToolCallDeltaRatio: .3, stylestatRegression: "warn" } };
    const result = grade(c, {
      dir: "x", stats: { completedChapters: 0, phase: "writing" },
      findings: [{ rule: "InProgressResidue", severity: "warning", title: "残留" }],
      checkpoints: [], pending: { in_progress: true }, loadErrors: [],
    });
    expect(result.outcome).toBe("FAIL");
    expect(result.hardFails).toContain("contract:no_pending in_progress");
    expect(result.hardFails).toContain("finding:InProgressResidue");
  });
});
