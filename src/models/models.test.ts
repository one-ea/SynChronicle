import { describe, expect, it } from "vitest";
import { ModelRegistry, sameModelId } from "./index.js";

describe("models", () => {
  it("resolves provider ids, dated aliases and vendor prefixes", () => {
    const registry = new ModelRegistry();
    expect(registry.resolve("anthropic/claude-sonnet-4-20250514")?.id).toBe("claude-sonnet-4");
    expect(registry.resolve("google/gemini-2.5-pro")?.provider).toBe("gemini");
    expect(registry.resolveContextWindow("gpt-5-mini")).toBe(400000);
    expect(sameModelId("GPT-4.1", "gpt-4-1-20250514")).toBe(true);
  });

  it("merges only meaningful fetched fields", () => {
    const registry = new ModelRegistry([{ provider: "x", id: "m", name: "old", contextWindow: 1, maxTokens: 2, inputCostPer1M: 1, outputCostPer1M: 1, cacheReadCostPer1M: 0, cacheWriteCostPer1M: 0 }]);
    registry.mergeModels([{ provider: "X", id: "M", name: "new", contextWindow: 9, maxTokens: 0, inputCostPer1M: 0, outputCostPer1M: 0, cacheReadCostPer1M: 0, cacheWriteCostPer1M: 0 }]);
    expect(registry.resolve("x/m")).toMatchObject({ name: "new", contextWindow: 9, maxTokens: 2, inputCostPer1M: 1 });
  });

  it("does not cross provider boundaries for qualified model references", () => {
    const registry = new ModelRegistry();
    expect(registry.resolve("unknown/gpt-5-mini")).toBeUndefined();
    expect(registry.resolve("openai/gpt-5-mini")?.provider).toBe("openai");
  });
});
