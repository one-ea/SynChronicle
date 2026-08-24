import { describe, expect, it } from "vitest";
import { computeDeltas } from "./deltas.js";
import type { CaseCollect, CaseMetrics } from "./collect.js";
import type { EvalGate } from "./index.js";

const gate: EvalGate = { maxSeverity: "warning", maxCostDeltaRatio: 0.3, maxToolCallDeltaRatio: 0.3, stylestatRegression: "warn" };

function metrics(overrides: Partial<CaseMetrics> = {}): CaseMetrics {
  return {
    completedChapters: 2, totalChapters: 10, totalWords: 2000, phase: "writing", flow: "writing",
    inProgressChapter: 0, toolCalls: 10, costUsd: 0.4, inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0,
    criticalFindings: 0, warningFindings: 1, chapterSummaries: 2, arcSummaries: 0, volumeSummaries: 0, reviews: 0,
    chapterWords: { 1: 1000, 2: 1000 },
    ...overrides,
  };
}

function collect(stats: CaseMetrics, stylestat: CaseCollect["stylestat"] = null): CaseCollect {
  return { dir: "x", stats, findings: [], checkpoints: [], pending: {}, stylestat, loadErrors: [] };
}

describe("computeDeltas", () => {
  it("is clean when nothing regresses", () => {
    const result = computeDeltas(gate, collect(metrics()), collect(metrics()));
    expect(result.hardFails).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("warns on tool call and cost growth beyond thresholds", () => {
    const result = computeDeltas(gate, collect(metrics()), collect(metrics({ toolCalls: 16, costUsd: 0.8 })));
    expect(result.warnings).toContainEqual(expect.stringContaining("tool_calls"));
    expect(result.warnings).toContainEqual(expect.stringContaining("cost_usd"));
    expect(result.hardFails).toEqual([]);
  });

  it("ignores delta gates when the threshold is explicitly 0", () => {
    const relaxed: EvalGate = { ...gate, maxCostDeltaRatio: 0, maxToolCallDeltaRatio: 0 };
    const result = computeDeltas(relaxed, collect(metrics()), collect(metrics({ toolCalls: 50, costUsd: 5 })));
    expect(result.warnings).toEqual([]);
  });

  it("warns on warning finding regression", () => {
    const result = computeDeltas(gate, collect(metrics()), collect(metrics({ warningFindings: 3 })));
    expect(result.warnings).toContainEqual(expect.stringContaining("warning_findings +2"));
  });

  it("flags word count anomalies outside 60%-180% of baseline", () => {
    const result = computeDeltas(gate, collect(metrics()), collect(metrics({ chapterWords: { 1: 300, 2: 2500 } })));
    expect(result.warnings).toContainEqual(expect.stringContaining("chapter:1 字数"));
    expect(result.warnings).toContainEqual(expect.stringContaining("chapter:2 字数"));
  });

  it("maps stylestat regression to warn or block per gate", () => {
    const stylestat = (perChapter: number) => ({
      chapters: 5,
      patterns: [{ name: "矫正句", total: Math.round(perChapter * 5), perChapter }],
      topPhrases: [],
      repeatedSentences: [],
      ending: { shortRatio: 0.4, medianRunes: 12 },
      openingTimeRate: 0.2,
      titleFormats: undefined,
    });
    const base = collect(metrics(), stylestat(1));
    const variant = collect(metrics(), stylestat(3));
    const warn = computeDeltas(gate, base, variant);
    expect(warn.warnings).toContainEqual(expect.stringContaining("stylestat 回归"));
    const block = computeDeltas({ ...gate, stylestatRegression: "block" }, base, variant);
    expect(block.hardFails).toContainEqual(expect.stringContaining("stylestat 回归"));
    const off = computeDeltas({ ...gate, stylestatRegression: "off" }, base, variant);
    expect(off.warnings).toEqual([]);
    expect(off.hardFails).toEqual([]);
  });

  it("notes insufficient sample when fewer than 5 chapters", () => {
    const result = computeDeltas(gate, collect(metrics(), null), collect(metrics(), null));
    expect(result.notes).toContainEqual(expect.stringContaining("insufficient_sample"));
    expect(result.stylestat.sampleSufficient).toBe(false);
  });

  it("flags title format mixing appearing in variant", () => {
    const base = collect(metrics(), {
      chapters: 5, patterns: [], topPhrases: [], repeatedSentences: [],
      ending: { shortRatio: 0.4, medianRunes: 12 }, openingTimeRate: 0.2, titleFormats: undefined,
    });
    const variant = collect(metrics(), {
      chapters: 5, patterns: [], topPhrases: [], repeatedSentences: [],
      ending: { shortRatio: 0.4, medianRunes: 12 }, openingTimeRate: 0.2, titleFormats: { withPrefix: 3, withoutPrefix: 2 },
    });
    const result = computeDeltas(gate, base, variant);
    expect(result.warnings).toContainEqual(expect.stringContaining("标题格式混用"));
  });
});
