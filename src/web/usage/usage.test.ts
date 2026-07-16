import { describe, expect, it } from "vitest";
import { normalizeUsageSummary, platformModelAvailability } from "./routes.js";

describe("usage projections", () => {
  it("converts PostgreSQL numeric aggregates explicitly", () => {
    expect(normalizeUsageSummary({ key: "writer", costUsd: "1.25", inputTokens: "10", outputTokens: "4", latencyMs: "32.5", credentialSources: ["environment"], priceSources: ["platform"] })).toEqual({ key: "writer", costUsd: 1.25, inputTokens: 10, outputTokens: 4, latencyMs: 32.5, credentialSources: ["environment"], priceSources: ["platform"], unknownPrice: false });
  });

  it("derives blocked unknown-price models from active platform configuration", () => {
    expect(platformModelAvailability([{ provider: "openai", model: "known", status: "active", metadata: {} }, { provider: "custom", model: "unknown", status: "active", metadata: { priceStatus: "unknown" } }, { provider: "off", model: "disabled", status: "disabled", metadata: { priceStatus: "unknown" } }])).toEqual([
      { model: "openai/known", available: true, unknownPrice: false },
      { model: "custom/unknown", available: false, unknownPrice: true, reason: "unknown_price" },
    ]);
  });
});
