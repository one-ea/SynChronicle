import { describe, expect, it } from "vitest";
import { evaluateArenaCandidates } from "./arena.js";

describe("Arena Evaluation", () => {
  it("compares two candidates and evaluates dimensions", () => {
    const textA = "他拔出长剑，剑尖指向地面。黑夜无声，风吹过树梢。他大步向前，每一步都踏在枯枝上。";
    const textB = "他不禁皱起了眉，仿佛狂风暴雨一般，某种程度上心中有一丝说不清道不明的慌张。";

    const comparison = evaluateArenaCandidates(
      1,
      { model: "model-alpha", text: textA },
      { model: "model-beta", text: textB },
    );

    expect(comparison.chapter).toBe(1);
    expect(comparison.candidateA.wordCount).toBeGreaterThan(0);
    expect(comparison.candidateB.wordCount).toBeGreaterThan(0);
    // textA 没有命中 AI 套话，textB 密集命中，A 应当在 AI 味维度胜出
    expect(comparison.candidateA.aitone?.score).toBeGreaterThan(comparison.candidateB.aitone?.score ?? 0);
    expect(comparison.overallWinner).toBe("A");
    expect(comparison.recommendation).toContain("model-alpha");
  });
});
