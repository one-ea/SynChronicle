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
});
