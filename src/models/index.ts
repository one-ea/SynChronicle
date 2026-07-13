export interface ModelEntry { provider: string; id: string; name: string; contextWindow: number; maxTokens: number; inputCostPer1M: number; outputCostPer1M: number; cacheReadCostPer1M: number; cacheWriteCostPer1M: number }
const baseline: ModelEntry[] = [
  { provider: "anthropic", id: "claude-sonnet-4", name: "Claude Sonnet 4", contextWindow: 1000000, maxTokens: 64000, inputCostPer1M: 3, outputCostPer1M: 15, cacheReadCostPer1M: .3, cacheWriteCostPer1M: 3.75 },
  { provider: "gemini", id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", contextWindow: 1048576, maxTokens: 65536, inputCostPer1M: 1.25, outputCostPer1M: 10, cacheReadCostPer1M: .125, cacheWriteCostPer1M: .375 },
  { provider: "openai", id: "gpt-5-mini", name: "GPT-5 Mini", contextWindow: 400000, maxTokens: 128000, inputCostPer1M: .25, outputCostPer1M: 2, cacheReadCostPer1M: .025, cacheWriteCostPer1M: 0 },
  { provider: "deepseek", id: "deepseek-chat", name: "DeepSeek V3", contextWindow: 131072, maxTokens: 16000, inputCostPer1M: .2288, outputCostPer1M: .9144, cacheReadCostPer1M: 0, cacheWriteCostPer1M: 0 },
];
const normalize = (id: string) => id.trim().toLowerCase().replaceAll(".", "-");
const normalizeProvider = (provider: string) => ({ google: "gemini" } as Record<string, string>)[provider.trim().toLowerCase()] ?? provider.trim().toLowerCase();
const dated = (suffix: string) => /^-\d{8}$/.test(suffix);
export function sameModelId(a: string, b: string): boolean { const x = normalize(a), y = normalize(b); return x === y || (x.startsWith(y) && dated(x.slice(y.length))) || (y.startsWith(x) && dated(y.slice(x.length))); }
export class ModelRegistry {
  private models: ModelEntry[];
  constructor(models: ModelEntry[] = baseline) { this.models = models.map(x => ({ ...x })); }
  resolve(pattern: string): ModelEntry | undefined {
    const input = pattern.trim(); if (!input) return undefined;
    const slash = input.indexOf("/"); const provider = slash > 0 ? input.slice(0, slash) : ""; const id = slash > 0 ? input.slice(slash + 1) : input;
    const providerMatches = provider ? this.models.filter(m => normalizeProvider(m.provider) === normalizeProvider(provider)) : this.models;
    const exact = providerMatches.find(m => sameModelId(m.id, id));
    if (exact) return { ...exact };
    const needle = normalize(id); const candidates = providerMatches.filter(m => normalize(m.id).includes(needle) || m.name.toLowerCase().includes(id.toLowerCase()));
    return candidates.sort((a, b) => Number(/-\d{8}$/.test(a.id)) - Number(/-\d{8}$/.test(b.id)))[0];
  }
  resolveContextWindow(pattern: string): number { return this.resolve(pattern)?.contextWindow ?? 0; }
  list(filter = ""): ModelEntry[] { const q = normalize(filter); return this.models.filter(m => !q || normalize(`${m.provider} ${m.id} ${m.name}`).includes(q)).map(m => ({ ...m })); }
  mergeModels(fetched: ModelEntry[]): void { for (const f of fetched) { const i = this.models.findIndex(m => `${m.provider}/${m.id}`.toLowerCase() === `${f.provider}/${f.id}`.toLowerCase()); if (i < 0) { this.models.push({ ...f }); continue; } const old = this.models[i]!; this.models[i] = { ...old, ...(f.name ? { name: f.name } : {}), ...(f.contextWindow > 0 ? { contextWindow: f.contextWindow } : {}), ...(f.maxTokens > 0 ? { maxTokens: f.maxTokens } : {}), ...((f.inputCostPer1M > 0 || f.outputCostPer1M > 0) ? { inputCostPer1M: f.inputCostPer1M, outputCostPer1M: f.outputCostPer1M, cacheReadCostPer1M: f.cacheReadCostPer1M, cacheWriteCostPer1M: f.cacheWriteCostPer1M } : {}) }; } }
}
export const defaultRegistry = new ModelRegistry();
