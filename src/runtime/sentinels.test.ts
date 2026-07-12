import { describe, expect, it, vi } from "vitest";
import { BudgetSentinel } from "./budget.js";
import { PausePointSentinel } from "./pause.js";

describe("BudgetSentinel", () => {
  it("warns once and stops on the next boundary", () => {
    const abort = vi.fn();
    const report = vi.fn();
    const sentinel = new BudgetSentinel({ book_usd: 10, warn_ratio: 0.8 }, abort, report);
    sentinel.onCost(8);
    sentinel.onCost(11);
    expect(report).toHaveBeenCalledTimes(2);
    expect(sentinel.handleBoundary()).toBe(true);
    expect(abort).toHaveBeenCalledOnce();
  });
});

describe("PausePointSentinel", () => {
  it("consumes a satisfied rewrite pause point", async () => {
    const clear = vi.fn(async () => undefined);
    const abort = vi.fn();
    const sentinel = new PausePointSentinel({
      loadMeta: async () => ({ pause_point: { after: "rewrite_queue_empty", reason: "review", set_at: "now" } }),
      loadProgress: async () => ({ phase: "writing", pending_rewrites: [] }),
      clear,
    }, abort);
    await expect(sentinel.handleBoundary()).resolves.toBe(true);
    expect(clear).toHaveBeenCalledOnce();
    expect(abort).toHaveBeenCalledWith(expect.stringContaining("review"));
  });
});
