export type QuotaErrorCode = "PRICE_UNKNOWN" | "INSUFFICIENT_BALANCE" | "BUDGET_EXCEEDED";

export class QuotaError extends Error {
  constructor(readonly code: QuotaErrorCode) {
    super(code);
    this.name = "QuotaError";
  }
}

export function quotaPolicy(input: { balanceUsd: number; budgetRemainingUsd: number | null; estimatedCostUsd: number | null }): void {
  if (input.estimatedCostUsd === null) throw new QuotaError("PRICE_UNKNOWN");
  if (!Number.isFinite(input.estimatedCostUsd) || input.estimatedCostUsd < 0) throw new QuotaError("PRICE_UNKNOWN");
  if (input.estimatedCostUsd > input.balanceUsd) throw new QuotaError("INSUFFICIENT_BALANCE");
  if (input.budgetRemainingUsd !== null && input.estimatedCostUsd > input.budgetRemainingUsd) throw new QuotaError("BUDGET_EXCEEDED");
}
