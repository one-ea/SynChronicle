import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildJudgePrompt, Judge, loadRubric, JUDGE_DIMENSIONS, type JudgeInput } from "./judge.js";

const model = { provider: "openai", modelId: "gpt-5-mini" } as never;

function rubricJson(name = "writer_chapter") {
  return {
    version: 1,
    name,
    role: "writer",
    updated_at: "2026-07-13",
    dimensions: JUDGE_DIMENSIONS.map((dimension, index) => ({ name: dimension, weight: index === 0 ? 30 : 70 / (JUDGE_DIMENSIONS.length - 1), criteria: `${dimension} 标准` })),
  };
}

function validOutput() {
  return {
    scores: { consistency: 8, character: 7, pacing: 8, continuity: 8, foreshadow: 7, hook: 7, aesthetic: 6 },
    winner: "variant",
    confidence: "medium",
    reasons: ["variant 行动推进更集中"],
    risks: ["variant 配角动机铺垫略少"],
  };
}

const input: JudgeInput = {
  caseId: "writer_five_chapters",
  prompt: "写一部都市奇幻长篇",
  chapter: 3,
  rubric: loadRubricSync(),
  baselineText: "baseline 正文",
  variantText: "variant 正文",
};

function loadRubricSync() {
  const dir = mkdtempSync(join(tmpdir(), "judge-"));
  const path = join(dir, "rubric.json");
  writeFileSync(path, JSON.stringify(rubricJson()));
  return loadRubric(path);
}

describe("loadRubric", () => {
  it("loads all bundled rubric snapshots", () => {
    for (const name of ["writer_chapter", "architect_outline", "editor_review"]) {
      const rubric = loadRubric(`evals/rubrics/${name}.json`);
      expect(rubric.version).toBeGreaterThanOrEqual(1);
      expect(rubric.dimensions).toHaveLength(7);
    }
  });

  it("loads a valid rubric and validates dimensions and weights", () => {
    const rubric = loadRubricSync();
    expect(rubric.version).toBe(1);
    expect(rubric.dimensions).toHaveLength(7);
  });

  it("rejects missing dimensions", () => {
    const dir = mkdtempSync(join(tmpdir(), "judge-bad-"));
    const path = join(dir, "bad.json");
    writeFileSync(path, JSON.stringify({ ...rubricJson(), dimensions: rubricJson().dimensions.slice(0, 3) }));
    expect(() => loadRubric(path)).toThrow(/全部 7 个维度/);
  });

  it("rejects unknown dimension names", () => {
    const dir = mkdtempSync(join(tmpdir(), "judge-bad-"));
    const path = join(dir, "bad.json");
    writeFileSync(path, JSON.stringify({ ...rubricJson(), dimensions: [{ name: "fun", weight: 100, criteria: "x" }, ...rubricJson().dimensions.slice(1)] }));
    expect(() => loadRubric(path)).toThrow(/维度 fun 非法/);
  });
});

describe("Judge", () => {
  it("returns structured result and forwards the prompt with both texts", async () => {
    const generate = vi.fn().mockResolvedValue({ text: JSON.stringify(validOutput()), usage: {} });
    const judge = new Judge({ model, generate });
    const run = await judge.judge(input);
    expect(run.ok).toBe(true);
    expect(run.result?.winner).toBe("variant");
    expect(run.result?.rubricVersion).toBe(1);
    expect(generate.mock.calls[0]?.[0].prompt).toContain("baseline 正文");
    expect(generate.mock.calls[0]?.[0].prompt).toContain("variant 正文");
    expect(generate.mock.calls[0]?.[0].prompt).toContain("consistency");
  });

  it("retries invalid JSON and reports failure without throwing", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: "invalid", usage: {} })
      .mockResolvedValueOnce({ text: JSON.stringify(validOutput()), usage: {} });
    const judge = new Judge({ model, generate, retryLimit: 2 });
    const run = await judge.judge(input);
    expect(run.ok).toBe(true);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("reports failure after retry exhaustion without affecting anything else", async () => {
    const generate = vi.fn().mockResolvedValue({ text: "invalid", usage: {} });
    const judge = new Judge({ model, generate, retryLimit: 1 });
    const run = await judge.judge(input);
    expect(run.ok).toBe(false);
    expect(run.error).toMatch(/judge failed after 2 attempts/);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("clips long chapter texts in the prompt", () => {
    const prompt = buildJudgePrompt({ ...input, baselineText: "x".repeat(5000) });
    expect(prompt.length).toBeLessThan(6000);
    expect(prompt).toContain("已截断");
  });
});
