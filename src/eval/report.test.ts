import { describe, expect, it } from "vitest";
import { buildReport, type RunReport } from "./report.js";

const report: RunReport = {
  runId: "20260713-120000",
  generatedAt: "2026-07-13T12:00:00.000Z",
  mode: "ab",
  variant: "writer-anti-ai-tone",
  repeat: 1,
  judgeEnabled: true,
  judgeCount: 1,
  judgeFailures: 0,
  gate: "WARN",
  cases: [
    {
      caseId: "writer_five_chapters",
      category: "longform",
      role: "writer",
      description: "连续 5 章",
      mode: "ab",
      outcome: "WARN",
      hardFails: [],
      warnings: ["tool_calls baseline=12 variant=16 +4 (+33.3%)（阈值 +30%）", "stylestat 回归：章末短句占比 baseline=0.4 variant=0.71 +0.31"],
      notes: [],
      passed: ["chapter:5:commit"],
      base: {
        dir: "out/artifacts/writer_five_chapters/baseline",
        metrics: { completedChapters: 5, totalChapters: 12, totalWords: 30000, phase: "writing", flow: "writing", inProgressChapter: 0, toolCalls: 12, costUsd: 0.42, inputTokens: 8200, outputTokens: 820, cacheReadTokens: 0, criticalFindings: 0, warningFindings: 1, chapterSummaries: 5, arcSummaries: 1, volumeSummaries: 0, reviews: 1, chapterWords: {} },
        stylestat: { chapters: 5, patterns: [{ name: "矫正句", total: 20, perChapter: 4 }], topPhrases: [], repeatedSentences: [], ending: { shortRatio: 0.4, medianRunes: 12 }, openingTimeRate: 0.2, titleFormats: undefined },
        findings: [],
        checkpoints: ["chapter:5:commit"],
      },
      variant: {
        dir: "out/artifacts/writer_five_chapters/variant",
        metrics: { completedChapters: 5, totalChapters: 12, totalWords: 31000, phase: "writing", flow: "writing", inProgressChapter: 0, toolCalls: 16, costUsd: 0.55, inputTokens: 9100, outputTokens: 950, cacheReadTokens: 0, criticalFindings: 0, warningFindings: 2, chapterSummaries: 5, arcSummaries: 1, volumeSummaries: 0, reviews: 1, chapterWords: {} },
        stylestat: { chapters: 5, patterns: [{ name: "矫正句", total: 27, perChapter: 5.4 }], topPhrases: [], repeatedSentences: [], ending: { shortRatio: 0.71, medianRunes: 11 }, openingTimeRate: 0.2, titleFormats: undefined },
        findings: [],
        checkpoints: ["chapter:5:commit"],
      },
      deltas: {
        metrics: {
          toolCalls: { base: 12, variant: 16, delta: 4, ratio: 0.333 },
          costUsd: { base: 0.42, variant: 0.55, delta: 0.13, ratio: 0.31 },
          inputTokens: { base: 8200, variant: 9100, delta: 900, ratio: 0.11 },
          outputTokens: { base: 820, variant: 950, delta: 130, ratio: 0.159 },
          criticalFindings: { base: 0, variant: 0, delta: 0, ratio: 0 },
          warningFindings: { base: 1, variant: 2, delta: 1, ratio: 1 },
          wordCountAnomalies: [],
        },
        stylestat: {
          sampleSufficient: true,
          patternPerChapter: { base: 4, variant: 5.4, delta: 1.4, ratio: 0.35 },
          endingShortRatio: { base: 0.4, variant: 0.71, delta: 0.31, ratio: 0.775 },
          openingTimeRate: { base: 0.2, variant: 0.2, delta: 0, ratio: 0 },
          titleMixed: null,
        },
        hardFails: [],
        warnings: ["tool_calls baseline=12 variant=16 +4 (+33.3%)（阈值 +30%）", "stylestat 回归：章末短句占比 baseline=0.4 variant=0.71 +0.31"],
        notes: [],
      },
      judge: {
        ok: true,
        result: {
          scores: { consistency: 8, character: 7, pacing: 8, continuity: 8, foreshadow: 7, hook: 7, aesthetic: 6 },
          winner: "variant",
          confidence: "medium",
          reasons: ["variant 行动推进更集中"],
          risks: [],
          rubricName: "writer_chapter",
          rubricVersion: 1,
          chapter: 5,
        },
      },
    },
  ],
};

describe("buildReport", () => {
  it("renders markdown with gate, metrics, stylestat and judge sections", () => {
    const rendered = buildReport(report);
    expect(rendered.md).toContain("Gate: WARN");
    expect(rendered.md).toContain("## writer_five_chapters（longform/writer）— WARN");
    expect(rendered.md).toContain("tool_calls");
    expect(rendered.md).toContain("stylestat 回归");
    expect(rendered.md).toContain("winner=variant");
    expect(rendered.md).toContain("writer_chapter v1");
    expect(rendered.md).toContain("artifacts: `out/artifacts/writer_five_chapters/baseline`");
  });

  it("keeps json identical to the run report", () => {
    const rendered = buildReport(report);
    expect(rendered.json).toEqual(report);
  });
});
