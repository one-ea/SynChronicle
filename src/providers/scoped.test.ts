import { describe, expect, it, vi } from "vitest";
import { credentialScopedModel } from "./scoped.js";

describe("credentialScopedModel", () => {
  it("resolves immediately before each provider call and releases in finally", async () => {
    const calls: string[] = [];
    const release = vi.fn(() => calls.push("release"));
    const resolve = vi.fn(async () => ({ apiKey: "secret-value", release }));
    const provider = vi.fn(() => ({ provider: "openai", modelId: "gpt-5", doGenerate: async () => { calls.push("call"); return { content: [], finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0 }, warnings: [] }; } }));
    const model = credentialScopedModel("openai", "gpt-5", "credential-1", {}, resolve, provider as never);
    await (model as unknown as { doGenerate(options: unknown): Promise<unknown> }).doGenerate({});
    expect(resolve).toHaveBeenCalledWith("credential-1", "openai");
    expect(calls).toEqual(["call", "release"]);
  });
});
