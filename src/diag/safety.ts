/**
 * 内容安全预检（specs/2026-09-19-p4-competitive-parity R5）。
 * 四组内置模式 + 请求附加模式，只产报告不阻断。
 */

export type SafetyCategory = "violenceDetail" | "pornographic" | "selfHarm" | "gamblingFraud" | "custom";

export interface SafetyPattern { category: SafetyCategory; pattern: string }

export interface SafetyHit { category: SafetyCategory; count: number; samples: string[] }
export interface SafetyReport { clean: boolean; hits: SafetyHit[]; scannedChars: number }

const BUILTIN_PATTERNS: SafetyPattern[] = [
  { category: "violenceDetail", pattern: "(斩首|开膛|肢解|掏心|脑浆|血浆横飞|虐杀过程)" },
  { category: "pornographic", pattern: "(性爱过程|生殖器|强奸|轮奸|猥亵身体|情欲抚摸大腿内侧)" },
  { category: "selfHarm", pattern: "(自杀方法|割腕教程|吞药自杀|上吊步骤|教我自杀)" },
  { category: "gamblingFraud", pattern: "(赌博网站|博彩平台|洗钱方法|诈骗话术|跑分平台|刷单返利)" },
];

export function scanSafety(text: string, extraPatterns: SafetyPattern[] = []): SafetyReport {
  const scannedChars = [...text.replace(/\s/g, "")].length;
  const hits: SafetyHit[] = [];
  const all = [...BUILTIN_PATTERNS, ...extraPatterns];
  for (const { category, pattern } of all) {
    let regex: RegExp;
    try { regex = new RegExp(pattern, "g"); } catch { continue; }
    const samples: string[] = [];
    let count = 0;
    for (const match of text.matchAll(regex)) {
      count += 1;
      if (samples.length < 3) samples.push(match[0].slice(0, 24));
    }
    if (count > 0) hits.push({ category, count, samples });
  }
  hits.sort((a, b) => b.count - a.count);
  return { clean: hits.length === 0, hits, scannedChars };
}
