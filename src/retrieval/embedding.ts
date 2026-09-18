/**
 * OpenAI 兼容嵌入检索（specs/2026-09-18-p1-quality-depth R1）。
 * 零依赖：fetch + JSON；失败由调用方回落 BM25。
 */

export interface EmbeddingConfig { base_url?: string; model?: string; api_key?: string; dimensions?: number }

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "text-embedding-3-small";

export function embeddingEndpoint(config: EmbeddingConfig): { url: string; model: string; apiKey: string } | null {
  const apiKey = config.api_key?.trim();
  if (!apiKey) return null;
  return { url: `${(config.base_url ?? DEFAULT_BASE_URL).replace(/\/+$/, "")}/embeddings`, model: config.model?.trim() || DEFAULT_MODEL, apiKey };
}

export async function embedTexts(config: EmbeddingConfig, texts: string[]): Promise<number[][]> {
  const endpoint = embeddingEndpoint(config);
  if (!endpoint) throw new Error("embedding 未配置 api_key");
  if (!texts.length) return [];
  const response = await fetch(endpoint.url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${endpoint.apiKey}` },
    body: JSON.stringify({ model: endpoint.model, input: texts, ...(config.dimensions ? { dimensions: config.dimensions } : {}) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`embedding 接口返回 ${response.status}`);
  const payload = (await response.json()) as { data?: Array<{ index?: number; embedding?: number[] }> };
  const rows = payload.data ?? [];
  if (rows.length !== texts.length || rows.some((row) => !Array.isArray(row.embedding))) throw new Error("embedding 响应形状非法");
  return rows.map((row) => row.embedding!);
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0, normA = 0, normB = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    dot += a[index]! * b[index]!;
    normA += a[index]! ** 2;
    normB += b[index]! ** 2;
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
