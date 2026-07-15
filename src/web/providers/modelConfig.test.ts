import { describe, expect, it } from "vitest";
import { validateModelSetInput, type ModelCatalog } from "./modelConfig.js";

const catalog: ModelCatalog = {
  credentials: [{ id: "11111111-1111-4111-8111-111111111111", provider: "openai" }],
  platformModels: [{ provider: "anthropic", model: "claude-sonnet" }],
};

describe("model configuration validation", () => {
  it("accepts per-Agent selections that reference a tenant credential", () => {
    expect(validateModelSetInput({
      name: "Drafting",
      agents: {
        writer: { provider: "openai", model: "gpt-5", credentialId: "11111111-1111-4111-8111-111111111111", parameters: { temperature: 0.4 } },
        reviewer: { provider: "anthropic", model: "claude-sonnet", parameters: { reasoningEffort: "high" } },
      },
    }, catalog)).toMatchObject({ name: "Drafting", agents: { writer: { model: "gpt-5" } } });
  });

  it("rejects unknown providers, platform models, and foreign credentials", () => {
    expect(() => validateModelSetInput({ name: "Bad", agents: { writer: { provider: "missing", model: "x" } } }, catalog)).toThrow("Provider");
    expect(() => validateModelSetInput({ name: "Bad", agents: { writer: { provider: "anthropic", model: "missing" } } }, catalog)).toThrow("model");
    expect(() => validateModelSetInput({ name: "Bad", agents: { writer: { provider: "openai", model: "gpt-5", credentialId: "22222222-2222-4222-8222-222222222222" } } }, catalog)).toThrow("credential");
  });

  it("never accepts secret-shaped fields", () => {
    expect(() => validateModelSetInput({ name: "Bad", agents: { writer: { provider: "openai", model: "gpt-5", apiKey: "secret" } } }, catalog)).toThrow();
  });
});
