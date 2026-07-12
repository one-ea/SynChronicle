import type { UsageState } from "../domain/index.js";
const empty = () => ({ input: 0, output: 0, cache_read: 0, cache_write: 0, cost_usd: 0, saved_usd: 0, cache_capable: false, cache_breaks: 0 });
export class UsageTracker {
  private state: UsageState = { schema: 1, updated_at: new Date().toISOString(), overall: empty(), per_agent: {}, per_model: {}, missing_assistant_usage: 0 };
  constructor(private readonly save?: (state: UsageState) => Promise<void>) {}
  load(state: UsageState | null): void { if (state) this.state = structuredClone(state); }
  record(agent: string, usage: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; totalCost?: number } | undefined): void { if (!usage) { this.state.missing_assistant_usage++; return; } const target = this.state.per_agent[agent] ??= empty(); for (const totals of [this.state.overall, target]) { totals.input += usage.inputTokens ?? 0; totals.output += usage.outputTokens ?? 0; totals.cache_read += usage.cachedInputTokens ?? 0; totals.cost_usd += usage.totalCost ?? 0; } this.state.updated_at = new Date().toISOString(); }
  snapshot(): UsageState { return structuredClone(this.state); }
  async flush(): Promise<void> { await this.save?.(this.snapshot()); }
}
