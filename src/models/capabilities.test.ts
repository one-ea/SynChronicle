import { describe, expect, it } from "vitest";
import {
  PlatformModelCapabilitiesSchema,
  defaultPlatformModelCapabilities,
  normalizePlatformModelCapabilities,
  assertSelectionAllowed,
  CREDENTIAL_POLICY_VIOLATION,
  PARAMETER_OUT_OF_RANGE,
  CAPABILITY_UNSUPPORTED,
} from "./capabilities.js";

describe("PlatformModelCapabilitiesSchema", () => {
  it("accepts full capabilities", () => {
    const input = {
      contextWindow: 128000,
      maxOutputTokens: 16384,
      pricing: { inputPer1M: 0.5, outputPer1M: 1.5, cacheReadPer1M: 0.1, cacheWritePer1M: 0.2 },
      modalities: { text: true, vision: true, audio: false },
      tools: { toolCalling: true, structuredOutput: true, jsonMode: false },
      generation: { streaming: true, temperature: { min: 0, max: 2 }, reasoningEffort: ["low", "medium", "high"], systemPrompt: true },
      policy: { allowPlatformCredential: true, allowUserCredential: true, tags: ["production"] },
    };
    const result = PlatformModelCapabilitiesSchema.parse(input);
    expect(result.contextWindow).toBe(128000);
    expect(result.maxOutputTokens).toBe(16384);
    expect(result.generation.reasoningEffort).toEqual(["low", "medium", "high"]);
  });

  it("applies safe defaults for partial input", () => {
    const result = PlatformModelCapabilitiesSchema.parse({ contextWindow: 4096, maxOutputTokens: 1024, pricing: { inputPer1M: 0, outputPer1M: 0 } });
    expect(result.modalities.vision).toBe(false);
    expect(result.modalities.audio).toBe(false);
    expect(result.tools.toolCalling).toBe(false);
    expect(result.generation.streaming).toBe(true);
    expect(result.generation.reasoningEffort).toEqual([]);
    expect(result.policy.allowPlatformCredential).toBe(true);
  });

  it("rejects negative context window", () => {
    expect(() => PlatformModelCapabilitiesSchema.parse({ contextWindow: -1, maxOutputTokens: 100, pricing: { inputPer1M: 0, outputPer1M: 0 } })).toThrow();
  });

  it("rejects reasoningEffort values outside enum", () => {
    expect(() => PlatformModelCapabilitiesSchema.parse({ contextWindow: 100, maxOutputTokens: 100, pricing: { inputPer1M: 0, outputPer1M: 0 }, generation: { reasoningEffort: ["extreme"] } })).toThrow();
  });
});

describe("defaultPlatformModelCapabilities", () => {
  it("returns conservative defaults", () => {
    const defaults = defaultPlatformModelCapabilities();
    expect(defaults.contextWindow).toBe(0);
    expect(defaults.maxOutputTokens).toBe(0);
    expect(defaults.tools.toolCalling).toBe(false);
    expect(defaults.policy.allowPlatformCredential).toBe(true);
  });
});

describe("normalizePlatformModelCapabilities", () => {
  it("fills missing fields with defaults", () => {
    const result = normalizePlatformModelCapabilities({});
    expect(result.contextWindow).toBe(0);
    expect(result.maxOutputTokens).toBe(0);
    expect(result.modalities.vision).toBe(false);
    expect(result.generation.reasoningEffort).toEqual([]);
  });

  it("does not overwrite provided fields", () => {
    const result = normalizePlatformModelCapabilities({ contextWindow: 131072, maxOutputTokens: 16000, pricing: { inputPer1M: 1, outputPer1M: 2 } });
    expect(result.contextWindow).toBe(131072);
    expect(result.generation.streaming).toBe(true);
  });

  it("returns default for null/undefined", () => {
    const result = normalizePlatformModelCapabilities(null);
    expect(result.contextWindow).toBe(0);
  });

  it("returns default for array input", () => {
    const result = normalizePlatformModelCapabilities([1, 2, 3]);
    expect(result.contextWindow).toBe(0);
  });
});

describe("assertSelectionAllowed", () => {
  const capabilities = normalizePlatformModelCapabilities({ contextWindow: 128000, maxOutputTokens: 16384, pricing: { inputPer1M: 1, outputPer1M: 2 }, generation: { temperature: { min: 0, max: 1.5 }, reasoningEffort: ["low", "medium"] }, tools: { toolCalling: true } });
  const entry = { capabilities };

  it("passes a valid selection", () => {
    expect(() => assertSelectionAllowed({ provider: "openai", model: "gpt-5", parameters: { temperature: 0.7, maxTokens: 4096, reasoningEffort: "medium" } }, entry, { allowPlatformCredential: true })).not.toThrow();
  });

  it("rejects temperature out of range", () => {
    expect(() => assertSelectionAllowed({ provider: "openai", model: "gpt-5", parameters: { temperature: 2.0 } }, entry, { allowPlatformCredential: true })).toThrow(PARAMETER_OUT_OF_RANGE);
  });

  it("rejects maxTokens exceeding model limit", () => {
    expect(() => assertSelectionAllowed({ provider: "openai", model: "gpt-5", parameters: { maxTokens: 99999 } }, entry, { allowPlatformCredential: true })).toThrow(PARAMETER_OUT_OF_RANGE);
  });

  it("rejects reasoningEffort not supported by model", () => {
    expect(() => assertSelectionAllowed({ provider: "openai", model: "gpt-5", parameters: { reasoningEffort: "high" } }, entry, { allowPlatformCredential: true })).toThrow(CAPABILITY_UNSUPPORTED);
  });

  it("rejects when policy disallows platform credential and no credentialId provided", () => {
    expect(() => assertSelectionAllowed({ provider: "openai", model: "gpt-5" }, entry, { allowPlatformCredential: false })).toThrow(CREDENTIAL_POLICY_VIOLATION);
  });

  it("rejects when policy disallows user credential and credentialId provided", () => {
    expect(() => assertSelectionAllowed({ provider: "openai", model: "gpt-5", credentialId: "some-uuid" }, entry, { allowPlatformCredential: true, allowUserCredential: false })).toThrow(CREDENTIAL_POLICY_VIOLATION);
  });

  it("passes platform path when platform credential allowed and no credentialId", () => {
    expect(() => assertSelectionAllowed({ provider: "openai", model: "gpt-5" }, entry, { allowPlatformCredential: true })).not.toThrow();
  });

  it("passes with no parameters provided", () => {
    expect(() => assertSelectionAllowed({ provider: "openai", model: "gpt-5" }, entry, { allowPlatformCredential: true })).not.toThrow();
  });
});
