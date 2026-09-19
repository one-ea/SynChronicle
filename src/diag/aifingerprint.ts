import { detectAitone } from "../stylestat/aitone.js";

/**
 * AI 痕迹自查（specs/2026-09-19-p6-consistency-and-platform R3）。
 * 行文指纹四信号（排比密度/句式工整度/模板词/总结性陈词）+ 人工改写幅度。零模型依赖。
 */

export interface FingerprintSignals { parallelism: number; uniformity: number; templated: number; summaryCliche: number }
export interface FingerprintReport { riskScore: number; signals: FingerprintSignals; aitoneHits: Array<{ name: string; count: number }>; scannedChars: number }
export interface AmplitudeReport { amplitude: number; compliant: boolean; draftChars: number; finalChars: number }
export interface BookAiEstimate { averageRisk: number; scanned: number; withDraft: number; averageAmplitude: number | null; complianceRate: number; advice: string }

function clamp(value: number): number { return Math.max(0, Math.min(100, Math.round(value))); }

/** 排比密度：连续 3+ 句以相同开头 2 字起句的组数。 */
function parallelismScore(text: string): number {
  const sentences = text.split(/[。！？!?]+/).map((item) => item.trim()).filter((item) => item.length > 2);
  let groups = 0;
  let run = 1;
  for (let index = 1; index < sentences.length; index += 1) {
    if (sentences[index]!.slice(0, 2) === sentences[index - 1]!.slice(0, 2)) {
      run += 1;
      if (run === 3) groups += 1;
    } else run = 1;
  }
  return clamp(groups * 25);
}

/** 句式工整度：句长变异系数越低风险越高。 */
function uniformityScore(text: string): number {
  const sentences = text.split(/[。！？!?]+/).map((item) => item.trim()).filter((item) => item.length > 2);
  if (sentences.length < 4) return 0;
  const lengths = sentences.map((item) => [...item].length);
  const mean = lengths.reduce((total, value) => total + value, 0) / lengths.length || 1;
  const variance = lengths.reduce((total, value) => total + (value - mean) ** 2, 0) / lengths.length;
  const cv = Math.sqrt(variance) / mean;
  return clamp(100 - cv * 220);
}

/** 总结性陈词密度。 */
const SUMMARY_CLICHES = ["总之", "综上所述", "不得不说", "无论如何", "从某种意义上", "在这一刻他明白"];

function summaryClicheScore(text: string): number {
  const chars = [...text.replace(/\s/g, "")].length;
  if (!chars) return 0;
  let hits = 0;
  for (const cliche of SUMMARY_CLICHES) hits += Math.max(0, text.split(cliche).length - 1);
  return clamp(((hits * 1000) / chars) * 25);
}

export function fingerprintScan(text: string): FingerprintReport | null {
  if (!text.trim()) return null;
  const aitone = detectAitone(text);
  const signals: FingerprintSignals = {
    parallelism: parallelismScore(text),
    uniformity: uniformityScore(text),
    templated: aitone ? clamp(aitone.hits.reduce((total, hit) => total + hit.count, 0) * 12) : 0,
    summaryCliche: summaryClicheScore(text),
  };
  const riskScore = clamp(signals.parallelism * 0.3 + signals.uniformity * 0.3 + signals.templated * 0.25 + signals.summaryCliche * 0.15);
  return {
    riskScore,
    signals,
    aitoneHits: aitone?.hits ?? [],
    scannedChars: [...text.replace(/\s/g, "")].length,
  };
}

/** 人工改写幅度：AI 草稿与定稿的 char-bigram Jaccard 差异（起点合规线 30%）。 */
export function rewriteAmplitude(draft: string, final: string): AmplitudeReport {
  const bigrams = (text: string): Set<string> => {
    const set = new Set<string>();
    for (const run of text.replace(/\s/g, "").match(/[\u4e00-\u9fff]+/g) ?? []) {
      const chars = [...run];
      for (let index = 0; index + 1 < chars.length; index += 1) set.add(chars[index]! + chars[index + 1]!);
    }
    return set;
  };
  const a = bigrams(draft);
  const b = bigrams(final);
  const intersection = [...a].filter((item) => b.has(item)).length;
  const union = new Set([...a, ...b]).size || 1;
  const similarity = intersection / union;
  const amplitude = Math.round((1 - similarity) * 100) / 100;
  return { amplitude, compliant: amplitude >= 0.3, draftChars: [...draft.replace(/\s/g, "")].length, finalChars: [...final.replace(/\s/g, "")].length };
}
