/**
 * 零依赖 BM25 检索（specs/2026-09-18-quality-trio）。
 * 分词策略：CJK 字符二元组（bigram）+ 连续 ASCII 词，适配无分词器的中文语料。
 */

const K1 = 1.5;
const B = 0.75;

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const ascii = text.match(/[A-Za-z0-9]+/g) ?? [];
  tokens.push(...ascii.map((word) => word.toLowerCase()));
  const cjkRuns = text.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const run of cjkRuns) {
    const chars = [...run];
    if (chars.length === 1) tokens.push(chars[0]!);
    else for (let index = 0; index + 1 < chars.length; index += 1) tokens.push(chars[index]! + chars[index + 1]!);
  }
  return tokens;
}

export interface Bm25Doc { id: number; text: string }
export interface Bm25Hit { id: number; score: number }

export function bm25Search(docs: Bm25Doc[], query: string, k: number): Bm25Hit[] {
  if (!docs.length || !query.trim() || k <= 0) return [];
  const tokenized = docs.map((doc) => ({ id: doc.id, tokens: tokenize(doc.text) }));
  const avgdl = tokenized.reduce((total, doc) => total + doc.tokens.length, 0) / tokenized.length || 1;
  const docFreq = new Map<string, number>();
  for (const doc of tokenized) for (const term of new Set(doc.tokens)) docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
  const queryTerms = [...new Set(tokenize(query))];
  const hits: Bm25Hit[] = tokenized.map((doc) => {
    const termFreq = new Map<string, number>();
    for (const term of doc.tokens) termFreq.set(term, (termFreq.get(term) ?? 0) + 1);
    let score = 0;
    for (const term of queryTerms) {
      const tf = termFreq.get(term) ?? 0;
      if (!tf) continue;
      const df = docFreq.get(term) ?? 0;
      const idf = Math.log(1 + (tokenized.length - df + 0.5) / (df + 0.5));
      score += idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.tokens.length) / avgdl)));
    }
    return { id: doc.id, score: Math.round(score * 1000) / 1000 };
  });
  return hits
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .slice(0, k);
}
