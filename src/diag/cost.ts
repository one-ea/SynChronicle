/**
 * 成本预估（specs/2026-09-19-p4-competitive-parity R5）。
 * 依据计划章节数/单章字数/字符-token 系数估算输入输出 token 与 USD 区间。
 * 内置常见模型价格表（USD / 1K tokens），请求参数可覆盖。
 */

export interface CostInput {
  chapters: number;
  wordsPerChapter: number;
  model?: string;
  charsPerToken?: number;
  priceInPerK?: number;
  priceOutPerK?: number;
  contextMultiplier?: number;
}

export interface CostEstimate {
  model: string;
  totalChars: number;
  inputTokens: number;
  outputTokens: number;
  usd: { low: number; high: number };
  basis: { charsPerToken: number; priceInPerK: number; priceOutPerK: number; contextMultiplier: number };
}

/** 常见模型价格（USD/1K tokens，输入, 输出），仅为缺省估算参考。 */
const PRICE_TABLE: Array<{ match: RegExp; in: number; out: number }> = [
  { match: /deepseek-chat|deepseek-v3/i, in: 0.00027, out: 0.0011 },
  { match: /deepseek-reasoner/i, in: 0.00055, out: 0.00219 },
  { match: /gpt-4o-mini/i, in: 0.00015, out: 0.0006 },
  { match: /gpt-4o/i, in: 0.0025, out: 0.01 },
  { match: /claude.*haiku/i, in: 0.0008, out: 0.004 },
  { match: /claude.*sonnet/i, in: 0.003, out: 0.015 },
  { match: /claude.*opus/i, in: 0.015, out: 0.075 },
  { match: /gemini.*flash/i, in: 0.0001, out: 0.0004 },
  { match: /gemini.*pro/i, in: 0.00125, out: 0.005 },
];

export function lookupPrice(model: string): { in: number; out: number } {
  for (const row of PRICE_TABLE) if (row.match.test(model)) return { in: row.in, out: row.out };
  return { in: 0, out: 0 };
}

export function estimateCost(input: CostInput): CostEstimate {
  const chapters = Math.max(0, Math.floor(input.chapters));
  const wordsPerChapter = Math.max(0, input.wordsPerChapter);
  const charsPerToken = input.charsPerToken && input.charsPerToken > 0 ? input.charsPerToken : 1.4;
  const contextMultiplier = input.contextMultiplier && input.contextMultiplier > 0 ? input.contextMultiplier : 4;
  const model = input.model?.trim() || "unknown";
  const tablePrice = lookupPrice(model);
  const priceInPerK = input.priceInPerK ?? tablePrice.in;
  const priceOutPerK = input.priceOutPerK ?? tablePrice.out;

  const outputChars = chapters * wordsPerChapter;
  const outputTokens = Math.ceil(outputChars / charsPerToken);
  // 输入包含：prompt 模板 + 设定注入 + 已写内容的滚动上下文，按输出 token 的倍数粗估。
  const inputTokens = Math.ceil(outputTokens * contextMultiplier);

  const mid = (inputTokens / 1000) * priceInPerK + (outputTokens / 1000) * priceOutPerK;
  const round = (value: number) => Math.round(value * 10000) / 10000;
  return {
    model,
    totalChars: outputChars,
    inputTokens,
    outputTokens,
    usd: { low: round(mid * 0.8), high: round(mid * 1.2) },
    basis: { charsPerToken, priceInPerK, priceOutPerK, contextMultiplier },
  };
}
