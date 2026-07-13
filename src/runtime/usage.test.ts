import { describe, expect, it } from "vitest";
import { normalizeUsage, UsageTracker } from "./usage.js";

describe("UsageTracker", () => {
  it("records only finite non-negative usage values", () => {
    const tracker = new UsageTracker();
    tracker.record("reviewer", normalizeUsage({ inputTokens: 12, outputTokens: Number.NaN, cachedInputTokens: -3, totalCost: Number.POSITIVE_INFINITY }));
    expect(tracker.snapshot().per_agent.reviewer).toMatchObject({ input: 12, output: 0, cache_read: 0, cost_usd: 0 });
  });

  it("ignores malformed usage without creating agent totals", () => {
    const tracker = new UsageTracker();
    tracker.record("reviewer", normalizeUsage({ inputTokens: "12" }));
    expect(tracker.snapshot().per_agent.reviewer).toBeUndefined();
    expect(tracker.snapshot().missing_assistant_usage).toBe(1);
  });

  it("counts usage objects without known fields as missing", () => {
    const tracker = new UsageTracker();
    tracker.record("reviewer", normalizeUsage({}));
    tracker.record("reviewer", normalizeUsage({ promptTokens: 12 }));
    expect(tracker.snapshot().per_agent.reviewer).toBeUndefined();
    expect(tracker.snapshot().missing_assistant_usage).toBe(2);
  });

  it("aggregates reviewer latency separately in overall and per-agent totals", () => {
    const tracker = new UsageTracker();
    tracker.record("reviewer", normalizeUsage({ inputTokens: 4, latencyMs: 12.5 }));
    tracker.record("reviewer", normalizeUsage({ outputTokens: 3, latencyMs: 7.5 }));

    expect(tracker.snapshot().overall.latency_ms).toBe(20);
    expect(tracker.snapshot().per_agent.reviewer?.latency_ms).toBe(20);
  });

  it("adds latency to usage totals loaded from older persisted data", () => {
    const tracker = new UsageTracker();
    tracker.load({
      schema: 1,
      updated_at: "old",
      overall: { input: 0, output: 0, cache_read: 0, cache_write: 0, cost_usd: 0, saved_usd: 0, cache_capable: false },
      per_agent: { reviewer: { input: 0, output: 0, cache_read: 0, cache_write: 0, cost_usd: 0, saved_usd: 0, cache_capable: false } },
      missing_assistant_usage: 0,
    });
    tracker.record("reviewer", normalizeUsage({ latencyMs: 9 }));

    expect(tracker.snapshot().overall.latency_ms).toBe(9);
    expect(tracker.snapshot().per_agent.reviewer?.latency_ms).toBe(9);
  });
});
