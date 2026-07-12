import type { BudgetConfig } from "../config/index.js";
type BudgetState = "normal" | "warned" | "stop-pending" | "stopped";
export class BudgetSentinel {
  private state: BudgetState = "normal";
  private readonly limit: number;
  private readonly warnRatio: number;
  private readonly hardStop: boolean;
  constructor(config: BudgetConfig, private readonly abort: (reason: string) => void, private readonly report: (level: string, summary: string) => void) { this.limit = config.book_usd ?? 0; this.warnRatio = config.warn_ratio ?? 0.8; this.hardStop = config.hard_stop ?? false; }
  get enabled(): boolean { return this.limit > 0; }
  get budgetLimit(): number { return this.limit; }
  onCost(total: number): void { if (!this.enabled || this.state === "stopped") return; if (this.state === "normal" && total >= this.limit * this.warnRatio) { this.state = "warned"; this.report("warn", `预算告警: 已花费 $${total.toFixed(2)}，达到预算 $${this.limit.toFixed(2)} 的 ${(this.warnRatio * 100).toFixed(0)}%`); } if ((this.state === "normal" || this.state === "warned") && total >= this.limit) { this.state = "stop-pending"; this.report("error", `预算用尽: 已花费 $${total.toFixed(2)}，超出预算 $${this.limit.toFixed(2)}`); if (this.hardStop) this.stop(total); } }
  handleBoundary(total = this.limit): boolean { if (this.state !== "stop-pending") return false; this.stop(total); return true; }
  refuse(total: number): void { if (this.enabled && total >= this.limit) throw new Error(`本书已花费 $${total.toFixed(2)}，达到预算上限 $${this.limit.toFixed(2)}`); }
  private stop(total: number): void { if (this.state !== "stop-pending") return; this.state = "stopped"; this.abort(`预算停机: 已花费 $${total.toFixed(2)}，超出预算 $${this.limit.toFixed(2)}`); }
}
