import { describe, expect, it } from "vitest";
import { applyRunConfiguration } from "./configuration.js";

describe("run configuration snapshot", () => {
  it("applies per-Agent provider, model, and safe parameters from the persisted task snapshot", () => {
    const config = applyRunConfiguration({ provider: "openai", model: "default", providers: { openai: {} }, roles: {}, reflection: { enabled: false } }, {
      configurationSnapshot: { modelSetId: "set-1", version: 2, agents: { writer: { provider: "openai", model: "gpt-5", credentialId: "credential-1", parameters: { reasoningEffort: "high", temperature: 0.4 } } } },
    });
    expect(config.roles?.writer).toMatchObject({ provider: "openai", model: "gpt-5", reasoning_effort: "high", credential_id: "credential-1", temperature: 0.4 });
  });
});
