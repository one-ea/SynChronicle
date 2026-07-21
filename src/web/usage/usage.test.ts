import { describe, expect, it } from "vitest";
import { normalizePlatformModelCapabilities } from "../../models/capabilities.js";
import { normalizeUsageSummary, platformModelAvailability } from "./routes.js";

describe("usage projections", () => {
  it("converts PostgreSQL numeric aggregates explicitly", () => {
    expect(normalizeUsageSummary({ key: "writer", costUsd: "1.25", inputTokens: "10", outputTokens: "4", latencyMs: "32.5", credentialSources: ["environment"], priceSources: ["platform"] })).toEqual({ key: "writer", costUsd: 1.25, inputTokens: 10, outputTokens: 4, latencyMs: 32.5, credentialSources: ["environment"], priceSources: ["platform"], unknownPrice: false });
  });

  it("derives blocked unknown-price models from active platform configuration", () => {
    expect(platformModelAvailability([{ provider: "openai", model: "known", status: "active", capabilities: undefined, metadata: {}, inputPrice: "1", outputPrice: "2" }, { provider: "custom", model: "unknown", status: "active", capabilities: undefined, metadata: { priceStatus: "unknown" }, inputPrice: "1", outputPrice: "2" }, { provider: "off", model: "disabled", status: "disabled", capabilities: undefined, metadata: { priceStatus: "unknown" } }])).toEqual([
      { model: "openai/known", available: true, unknownPrice: false, capabilities: normalizePlatformModelCapabilities(undefined) },
      { model: "custom/unknown", available: false, unknownPrice: true, capabilities: normalizePlatformModelCapabilities(undefined), reason: "unknown_price" },
    ]);
  });

  it("includes capabilities in platform model availability", () => {
    const result = platformModelAvailability([
      { provider: "openai", model: "known", status: "active", metadata: {}, inputPrice: "1", outputPrice: "2", capabilities: { contextWindow: 128000, maxOutputTokens: 16384, generation: { temperature: { min: 0, max: 2 }, reasoningEffort: ["low", "medium"] }, tools: { toolCalling: true }, modalities: { text: true, vision: false, audio: false }, policy: { allowPlatformCredential: true, allowUserCredential: true, tags: [] } } },
    ]);
    expect(result[0]).toMatchObject({
      model: "openai/known", available: true, unknownPrice: false,
      capabilities: expect.objectContaining({ contextWindow: 128000, maxOutputTokens: 16384 }),
    });
  });
});
