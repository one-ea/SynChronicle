import type { EvalGate } from "./index.js";
import type { CaseCollect } from "./collect.js";

/** 数值型 delta：ratio 为 null 表示 baseline 为 0 而 variant 非 0（"新增"）。 */
export interface MetricDelta {
  base: number;
  variant: number;
  delta: number;
  ratio: number | null;
}

export interface CaseDeltas {
  metrics: {
    toolCalls: MetricDelta;
    costUsd: MetricDelta;
    inputTokens: MetricDelta;
    outputTokens: MetricDelta;
    criticalFindings: MetricDelta;
    warningFindings: MetricDelta;
    wordCountAnomalies: Array<{ chapter: number; base: number; variant: number }>;
  };
  stylestat: {
    sampleSufficient: boolean;
    patternPerChapter: MetricDelta | null;
    endingShortRatio: MetricDelta | null;
    openingTimeRate: MetricDelta | null;
    titleMixed: boolean | null;
  };
  hardFails: string[];
  warnings: string[];
  notes: string[];
}

/** 章节字数低于 baseline 60% 或高于 180% 视为异常（docs/evaluation-system.md §7.2）。 */
const WORD_LOW_RATIO = 0.6;
const WORD_HIGH_RATIO = 1.8;
/** 文体指标绝对增幅超过该值视为回归信号。 */
const STYLESTAT_DELTA_EPSILON = 0.05;

export function computeDeltas(gate: EvalGate, base: CaseCollect, variant: CaseCollect): CaseDeltas {
  const hardFails: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];

  const toolCalls = delta(base.stats.toolCalls, variant.stats.toolCalls);
  const costUsd = delta(base.stats.costUsd, variant.stats.costUsd);
  const inputTokens = delta(base.stats.inputTokens, variant.stats.inputTokens);
  const outputTokens = delta(base.stats.outputTokens, variant.stats.outputTokens);
  const criticalFindings = delta(base.stats.criticalFindings, variant.stats.criticalFindings);
  const warningFindings = delta(base.stats.warningFindings, variant.stats.warningFindings);

  if (gate.maxToolCallDeltaRatio > 0 && exceeds(toolCalls, gate.maxToolCallDeltaRatio)) {
    warnings.push(`tool_calls ${fmtRatio(toolCalls)}（阈值 +${Math.round(gate.maxToolCallDeltaRatio * 100)}%）`);
  }
  if (gate.maxCostDeltaRatio > 0 && exceeds(costUsd, gate.maxCostDeltaRatio)) {
    warnings.push(`cost_usd ${fmtRatio(costUsd)}（阈值 +${Math.round(gate.maxCostDeltaRatio * 100)}%）`);
  }
  if (gate.maxCostDeltaRatio > 0 && exceeds(inputTokens, gate.maxCostDeltaRatio)) {
    warnings.push(`input_tokens ${fmtRatio(inputTokens)}`);
  }
  if (gate.maxCostDeltaRatio > 0 && exceeds(outputTokens, gate.maxCostDeltaRatio)) {
    warnings.push(`output_tokens ${fmtRatio(outputTokens)}`);
  }
  if (criticalFindings.delta > 0) warnings.push(`critical_findings +${criticalFindings.delta}`);
  if (warningFindings.delta > 0) warnings.push(`warning_findings +${warningFindings.delta}`);

  const wordCountAnomalies: CaseDeltas["metrics"]["wordCountAnomalies"] = [];
  for (const [chapter, variantWords] of Object.entries(variant.stats.chapterWords)) {
    const baseWords = base.stats.chapterWords[Number(chapter)];
    if (baseWords === undefined || baseWords === 0) continue;
    const ratio = variantWords / baseWords;
    if (ratio < WORD_LOW_RATIO || ratio > WORD_HIGH_RATIO) {
      wordCountAnomalies.push({ chapter: Number(chapter), base: baseWords, variant: variantWords });
      warnings.push(`chapter:${chapter} 字数 ${variantWords} vs baseline ${baseWords}（${Math.round(ratio * 100)}%）超出 [${Math.round(WORD_LOW_RATIO * 100)}%, ${Math.round(WORD_HIGH_RATIO * 100)}%]`);
    }
  }

  const sampleSufficient = base.stylestat !== null && variant.stylestat !== null;
  const stylestat = {
    sampleSufficient,
    patternPerChapter: null as MetricDelta | null,
    endingShortRatio: null as MetricDelta | null,
    openingTimeRate: null as MetricDelta | null,
    titleMixed: null as boolean | null,
  };
  if (!sampleSufficient) {
    notes.push("stylestat: 样本不足 5 章（insufficient_sample），文体回归跳过");
  } else {
    const basePattern = sumPatterns(base.stylestat!);
    const variantPattern = sumPatterns(variant.stylestat!);
    stylestat.patternPerChapter = delta(basePattern, variantPattern);
    stylestat.endingShortRatio = delta(base.stylestat!.ending.shortRatio, variant.stylestat!.ending.shortRatio);
    stylestat.openingTimeRate = delta(base.stylestat!.openingTimeRate, variant.stylestat!.openingTimeRate);
    stylestat.titleMixed = !base.stylestat!.titleFormats && Boolean(variant.stylestat!.titleFormats);

    if (gate.stylestatRegression === "off") {
      notes.push("stylestat: 回归门禁关闭（off）");
    } else {
      const regressions: string[] = [];
      if (stylestat.patternPerChapter.delta > STYLESTAT_DELTA_EPSILON) regressions.push(`句式模式章均 ${fmtDelta(stylestat.patternPerChapter)}`);
      if (stylestat.endingShortRatio.delta > STYLESTAT_DELTA_EPSILON) regressions.push(`章末短句占比 ${fmtDelta(stylestat.endingShortRatio)}`);
      if (stylestat.openingTimeRate.delta > STYLESTAT_DELTA_EPSILON) regressions.push(`开篇时间词率 ${fmtDelta(stylestat.openingTimeRate)}`);
      if (stylestat.titleMixed) regressions.push("标题格式混用出现");
      for (const regression of regressions) {
        const message = `stylestat 回归：${regression}`;
        if (gate.stylestatRegression === "block") hardFails.push(message);
        else warnings.push(message);
      }
    }
  }

  return {
    metrics: { toolCalls, costUsd, inputTokens, outputTokens, criticalFindings, warningFindings, wordCountAnomalies },
    stylestat,
    hardFails,
    warnings,
    notes,
  };
}

function sumPatterns(stats: NonNullable<import("./collect.js").CaseCollect["stylestat"]>): number {
  return stats.patterns.reduce((sum, pattern) => sum + pattern.perChapter, 0);
}

function delta(base: number, variant: number): MetricDelta {
  const change = variant - base;
  return { base, variant, delta: Math.round(change * 100) / 100, ratio: base === 0 ? (variant === 0 ? 0 : null) : Math.round((change / base) * 1000) / 1000 };
}

function exceeds(metric: MetricDelta, threshold: number): boolean {
  return metric.ratio !== null && metric.ratio > threshold;
}

function fmtRatio(metric: MetricDelta): string {
  if (metric.ratio === null) return `${metric.base} → ${metric.variant}（新增）`;
  const sign = metric.delta >= 0 ? "+" : "";
  return `baseline=${metric.base} variant=${metric.variant} ${sign}${metric.delta} (${sign}${Math.round(metric.ratio * 100)}%)`;
}

function fmtDelta(metric: MetricDelta): string {
  const sign = metric.delta >= 0 ? "+" : "";
  return `baseline=${metric.base} variant=${metric.variant} ${sign}${metric.delta}`;
}
