import { describe, expect, it } from "vitest";
import { estimateCost, lookupPrice } from "./cost.js";

describe("cost 成本预估", () => {
  it("estimates tokens and usd range with defaults", () => {
    const report = estimateCost({ chapters: 24, wordsPerChapter: 3000, model: "deepseek-chat" });
    expect(report.totalChars).toBe(72000);
    expect(report.outputTokens).toBe(Math.ceil(72000 / 1.4));
    expect(report.inputTokens).toBe(report.outputTokens * 4);
    expect(report.usd.high).toBeGreaterThan(report.usd.low);
    expect(report.usd.high).toBeLessThanOrEqual(report.usd.low * 1.51);
  });

  it("matches builtin price table by model name", () => {
    expect(lookupPrice("gpt-4o-mini")).toEqual({ in: 0.00015, out: 0.0006 });
    expect(lookupPrice("claude-3-5-sonnet")).toEqual({ in: 0.003, out: 0.015 });
    expect(lookupPrice("totally-unknown-model")).toEqual({ in: 0, out: 0 });
  });

  it("allows request overrides for factors and prices", () => {
    const report = estimateCost({ chapters: 10, wordsPerChapter: 1000, charsPerToken: 1, priceInPerK: 0.5, priceOutPerK: 1.5, contextMultiplier: 2 });
    expect(report.outputTokens).toBe(10000);
    expect(report.inputTokens).toBe(20000);
    expect(report.usd.low).toBeGreaterThan(10);
    expect(report.basis.charsPerToken).toBe(1);
  });

  it("clamps invalid inputs to zero", () => {
    expect(estimateCost({ chapters: -5, wordsPerChapter: 0 }).totalChars).toBe(0);
  });
});
