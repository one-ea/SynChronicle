import type { UsageState } from "../domain/index.js";
import { defaultRegistry } from "../models/index.js";
export interface ModelIdentity { provider: string; model: string; }
export interface ModelUsage { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; totalCost?: number; latencyMs?: number; model?: ModelIdentity; costUnknown?: boolean; }
export interface UsagePricing { inputCostPer1M: number; outputCostPer1M: number; cacheReadCostPer1M?: number; }
const empty = () => ({ input: 0, output: 0, cache_read: 0, cache_write: 0, cost_usd: 0, saved_usd: 0, cache_capable: false, cache_breaks: 0 });
export class UsageTracker {
  private state: UsageState = { schema: 1, updated_at: new Date().toISOString(), overall: empty(), per_agent: {}, per_model: {}, missing_assistant_usage: 0 };
  private pending: Promise<void> = Promise.resolve();
  private saveError: Error | null = null;
  constructor(private readonly save?: (state: UsageState) => Promise<void>) {}
  load(state: UsageState | null): void { if (state) this.state = structuredClone(state); }
  record(agent: string, usage: ModelUsage | undefined): void { if (!usage) { this.state.missing_assistant_usage++; this.enqueueSave(); return; } const target = this.state.per_agent[agent] ??= empty(); const modelKey = usage.model ? `${usage.model.provider}/${usage.model.model}` : undefined; const modelTarget = modelKey ? (this.state.per_model ??= {})[modelKey] ??= empty() : undefined; for (const totals of [this.state.overall, target, modelTarget].filter((value) => value !== undefined)) { totals.input += usage.inputTokens ?? 0; totals.output += usage.outputTokens ?? 0; totals.cache_read += usage.cachedInputTokens ?? 0; totals.cost_usd += usage.totalCost ?? 0; totals.latency_ms = (totals.latency_ms ?? 0) + (usage.latencyMs ?? 0); } if (modelKey && usage.costUnknown && !this.state.unknown_cost_models?.includes(modelKey)) this.state.unknown_cost_models = [...(this.state.unknown_cost_models ?? []), modelKey]; this.state.updated_at = new Date().toISOString(); this.enqueueSave(); }
  snapshot(): UsageState { return structuredClone(this.state); }
  async flush(): Promise<void> { await this.pending; if (this.saveError) throw this.saveError; }
  private enqueueSave(): void { if (!this.save) return; const snapshot = this.snapshot(); this.pending = this.pending.then(() => this.save!(snapshot), () => this.save!(snapshot)).catch((error) => { this.saveError ??= error instanceof Error ? error : new Error(String(error)); }); }
}

export function normalizeUsage(value: unknown, model?: ModelIdentity): ModelUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const result: ModelUsage = {};
  let accepted = false;
  for (const key of ["inputTokens", "outputTokens", "cachedInputTokens", "totalCost", "latencyMs"] as const) {
    if (!(key in source)) continue;
    const field = source[key];
    if (typeof field === "number" && Number.isFinite(field) && field >= 0) { result[key] = field; accepted = true; }
  }
  if (model) {
    result.model = model;
    if (result.totalCost === undefined) {
      const pricing = defaultRegistry.resolve(`${model.provider}/${model.model}`);
      if (pricing) {
        result.totalCost = calculateUsageCost(result, pricing);
      } else {
        result.totalCost = 0;
        result.costUnknown = true;
      }
    }
  }
  return accepted ? result : undefined;
}

export function calculateUsageCost(usage: Pick<ModelUsage, "inputTokens" | "outputTokens" | "cachedInputTokens">, pricing: UsagePricing): number {
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens ?? 0);
  const uncached = Math.max(0, (usage.inputTokens ?? 0) - cached);
  return (uncached * pricing.inputCostPer1M + cached * (pricing.cacheReadCostPer1M ?? pricing.inputCostPer1M) + (usage.outputTokens ?? 0) * pricing.outputCostPer1M) / 1_000_000;
}
