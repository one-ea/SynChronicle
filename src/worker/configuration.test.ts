import { describe, expect, it } from "vitest";
import { applyRunConfiguration } from "./configuration.js";

describe("run configuration snapshot", () => {
  it("applies per-Agent provider, model, and safe parameters from the persisted task snapshot", () => {
    const config = applyRunConfiguration({ provider: "openai", model: "default", providers: { openai: {} }, roles: {}, reflection: { enabled: false } }, {
      configurationSnapshot: { modelSetId: "set-1", version: 2, agents: { writer: { provider: "openai", model: "gpt-5", credentialId: "credential-1", parameters: { reasoningEffort: "high", temperature: 0.4 } } } },
    });
    expect(config.roles?.writer).toMatchObject({ provider: "openai", model: "gpt-5", reasoning_effort: "high", credential_id: "credential-1", temperature: 0.4 });
  });

  it("rejects run configuration when parameters exceed model capabilities", () => {
    expect(() => applyRunConfiguration(
      { provider: "openai", model: "default", providers: { openai: {} }, roles: {}, reflection: { enabled: false } },
      {
        configurationSnapshot: {
          modelSetId: "set-1", version: 2,
          agents: {
            writer: { provider: "openai", model: "gpt-5", parameters: { maxTokens: 999999, temperature: 5.0 } },
          },
          capabilities: { writer: { maxOutputTokens: 4096, generation: { temperature: { min: 0, max: 1.5 }, reasoningEffort: ["low"] } } },
        },
      },
    )).toThrow("parameter_out_of_range");
  });

  it("accepts run configuration with parameters within capability bounds", () => {
    const config = applyRunConfiguration(
      { provider: "openai", model: "default", providers: { openai: {} }, roles: {}, reflection: { enabled: false } },
      {
        configurationSnapshot: {
          modelSetId: "set-1", version: 2,
          agents: {
            writer: { provider: "openai", model: "gpt-5", parameters: { temperature: 0.4, maxTokens: 2048, reasoningEffort: "low" } },
          },
          capabilities: { writer: { maxOutputTokens: 16384, generation: { temperature: { min: 0, max: 2 }, reasoningEffort: ["low", "medium"] } } },
        },
      },
    );
    expect(config.roles?.writer).toMatchObject({ provider: "openai", model: "gpt-5", temperature: 0.4 });
  });
});
