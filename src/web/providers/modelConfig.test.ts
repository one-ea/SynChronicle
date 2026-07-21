import { describe, expect, it } from "vitest";
import { validateModelSetInput, type ModelCatalog } from "./modelConfig.js";
import type { PlatformModelCapabilities } from "../../models/capabilities.js";

const defaultCaps: PlatformModelCapabilities = {
  contextWindow: 128000,
  maxOutputTokens: 16384,
  pricing: { inputPer1M: 0, outputPer1M: 0 },
  modalities: { text: true, vision: false, audio: false },
  tools: { toolCalling: true, structuredOutput: false, jsonMode: false },
  generation: { streaming: true, temperature: { min: 0, max: 2 }, reasoningEffort: ["low", "medium", "high"], systemPrompt: true },
  policy: { allowPlatformCredential: true, allowUserCredential: true, tags: [] },
};

const catalog: ModelCatalog = {
  credentials: [{ id: "11111111-1111-4111-8111-111111111111", provider: "openai" }],
  platformModels: [
    { provider: "anthropic", model: "claude-sonnet", capabilities: defaultCaps },
    { provider: "openai", model: "gpt-5", capabilities: defaultCaps },
  ],
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
    expect(() => validateModelSetInput({ name: "Bad", agents: { writer: { provider: "missing", model: "x" } } }, catalog)).toThrow("model_unavailable");
    expect(() => validateModelSetInput({ name: "Bad", agents: { writer: { provider: "anthropic", model: "missing" } } }, catalog)).toThrow("model_unavailable");
    expect(() => validateModelSetInput({ name: "Bad", agents: { writer: { provider: "openai", model: "gpt-5", credentialId: "22222222-2222-4222-8222-222222222222" } } }, catalog)).toThrow("credential");
  });

  it("never accepts secret-shaped fields", () => {
    expect(() => validateModelSetInput({ name: "Bad", agents: { writer: { provider: "openai", model: "gpt-5", apiKey: "secret" } } }, catalog)).toThrow();
  });

  it("rejects parameters that exceed model capabilities", () => {
    const capsCatalog: ModelCatalog = {
      credentials: [],
      platformModels: [{ provider: "openai", model: "gpt-5", capabilities: { contextWindow: 100000, maxOutputTokens: 4096, pricing: { inputPer1M: 0, outputPer1M: 0 }, modalities: { text: true, vision: false, audio: false }, tools: { toolCalling: false, structuredOutput: false, jsonMode: false }, generation: { streaming: true, temperature: { min: 0, max: 1.5 }, reasoningEffort: ["low"], systemPrompt: true }, policy: { allowPlatformCredential: true, allowUserCredential: false, tags: [] } } }],
    };
    expect(() => validateModelSetInput({
      name: "Bad params",
      agents: { writer: { provider: "openai", model: "gpt-5", parameters: { maxTokens: 99999 } } },
    }, capsCatalog)).toThrow("parameter_out_of_range");

    expect(() => validateModelSetInput({
      name: "Bad reasoning",
      agents: { writer: { provider: "openai", model: "gpt-5", parameters: { reasoningEffort: "high" } } },
    }, capsCatalog)).toThrow("capability_unsupported");

    expect(() => validateModelSetInput({
      name: "Bad temp",
      agents: { writer: { provider: "openai", model: "gpt-5", parameters: { temperature: 2.0 } } },
    }, capsCatalog)).toThrow("parameter_out_of_range");
  });

  it("accepts valid parameters within model capabilities", () => {
    const capsCatalog: ModelCatalog = {
      credentials: [],
      platformModels: [{ provider: "openai", model: "gpt-5", capabilities: { contextWindow: 100000, maxOutputTokens: 16384, pricing: { inputPer1M: 0, outputPer1M: 0 }, modalities: { text: true, vision: false, audio: false }, tools: { toolCalling: false, structuredOutput: false, jsonMode: false }, generation: { streaming: true, temperature: { min: 0, max: 2 }, reasoningEffort: ["low", "medium", "high"], systemPrompt: true }, policy: { allowPlatformCredential: true, allowUserCredential: true, tags: [] } } }],
    };
    expect(validateModelSetInput({
      name: "Valid params",
      agents: { writer: { provider: "openai", model: "gpt-5", parameters: { temperature: 0.4, maxTokens: 2048, reasoningEffort: "medium" } } },
    }, capsCatalog)).toMatchObject({ name: "Valid params" });
  });
});
