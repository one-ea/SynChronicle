/**
 * 反 AI 味检测（specs/2026-09-18-quality-trio，警示不拦截）。
 * 词表与 assets/references/anti-ai-tone.md §二「用词 AI 味」的可枚举条目同源；
 * 语义层判断（结构/描写/对话 AI 味）仍由 editor 按 anti-ai-tone.md 评审。
 */

export interface AitoneHit { name: string; count: number; samples: string[] }
export interface AitoneResult { score: number; hits: AitoneHit[] }

interface Pattern { readonly name: string; readonly regex: RegExp; readonly penalty: number }

const PATTERNS: readonly Pattern[] = [
  { name: "量词癖『一丝/一抹/一缕』", regex: /一[丝抹缕]百?般?/g, penalty: 6 },
  { name: "虚词癖『不禁/竟然/不由得』", regex: /不禁|竟然|不由得|下意识地/g, penalty: 6 },
  { name: "明喻套句『如同/宛如/仿佛…一般』", regex: /(?:如同|宛如|仿佛)[^。！？\n]{0,24}?(?:一般|似的|一样|般)/g, penalty: 10 },
  { name: "对比定义句式『不是…而是…』", regex: /不是[^。！？\n]{1,24}?[，、]?(?:而)?是/g, penalty: 10 },
  { name: "抽象大词『某种程度上/不知为何』", regex: /某种程度上|值得注意的是|不知为何|说不清道不明/g, penalty: 12 },
  { name: "情绪贴标签『他很紧张/愤怒』", regex: /[他她它们](?:很|十分|非常|极其)(?:紧张|愤怒|悲伤|惊讶|害怕|高兴)/g, penalty: 8 },
];

export function detectAitone(text: string): AitoneResult | null {
  if (!text || !text.trim()) return null;
  const runes = [...text].length || 1;
  const hits: AitoneHit[] = [];
  let penalty = 0;
  for (const pattern of PATTERNS) {
    const matches = [...text.matchAll(pattern.regex)];
    if (!matches.length) continue;
    const count = matches.length;
    const perThousand = (count * 1000) / runes;
    penalty += perThousand * pattern.penalty;
    hits.push({ name: pattern.name, count, samples: matches.slice(0, 2).map((match) => match[0].slice(0, 12)) });
  }
  hits.sort((a, b) => b.count - a.count);
  return { score: Math.max(0, Math.round(100 - penalty)), hits };
}
