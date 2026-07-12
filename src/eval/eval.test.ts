import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { aggregate, grade, loadCases } from "./index.js";

describe("eval", () => {
  it("loads and validates cases", () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-"));
    writeFileSync(join(dir, "a.json"), JSON.stringify({ id: "safe_case", category: "smoke", prompt: "x", max_chapters: 1, expect: {}, gate: {} }));
    expect(loadCases(dir)[0]?.gate.maxSeverity).toBe("warning");
    writeFileSync(join(dir, "b.json"), JSON.stringify({ id: "../bad", prompt: "x", expect: {}, gate: {} }));
    expect(() => loadCases(dir)).toThrow(/非法/);
  });

  it("grades deterministic contracts and aggregates", () => {
    const c = { id: "x", category: "smoke", prompt: "x", maxChapters: 1, expect: { phase: "writing", minCompletedChapters: 1, requiredCheckpoints: ["chapter:1:commit"], noPending: ["pending_commit"] }, gate: { maxSeverity: "warning", maxCostDeltaRatio: .3, maxToolCallDeltaRatio: .3, stylestatRegression: "warn" } };
    const result = grade(c, { dir: "x", stats: { completedChapters: 1, phase: "writing" }, findings: [], checkpoints: ["chapter:1:commit"], pending: {}, loadErrors: [] });
    expect(result.outcome).toBe("PASS");
    expect(aggregate("r", "single", "", 1, [{ caseId: "x", category: "smoke", outcome: "WARN", runs: [], deltas: [], summary: { passRate: 0, hardFailRuns: 0, warningRuns: 1 } }]).gate).toBe("WARN");
  });
});
