import { describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
type LanguageModelInstance = Exclude<LanguageModel, string>;
import { createProvider } from "./adapter.js";
import { knownProviderType } from "./mapping.js";
import { ModelSet } from "./modelset.js";
import { withExtra } from "./extra.js";

const result = (text: string) => ({
  content: [{ type: "text" as const, text }],
  finishReason: "stop" as const,
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  warnings: [],
});

function mockModel(provider: string, modelId: string, generate = vi.fn(async () => result(modelId))): LanguageModelInstance {
  return {
    specificationVersion: "v2",
    provider,
    modelId,
    supportedUrls: {},
    doGenerate: generate,
    doStream: vi.fn(),
  };
}

describe("provider mapping", () => {
  it.each([
    ["openai", "openai"], ["anthropic", "anthropic"], ["gemini", "google"],
    ["openrouter", "openai"], ["deepseek", "openai"], ["qwen", "openai"],
    ["glm", "openai"], ["grok", "openai"], ["ollama", "openai"], ["bedrock", "bedrock"],
  ])("maps %s to %s", (name, type) => expect(knownProviderType(name)).toBe(type));
});

describe("adapter", () => {
  it("selects the OpenAI Responses API", () => {
    const responses = vi.fn(() => mockModel("openai.responses", "gpt-5"));
    const chat = vi.fn();
    const model = createProvider("openai", { api: "responses", api_key: "test" }, "gpt-5", {
      openai: () => Object.assign(vi.fn(), { responses, chat }),
    });
    expect(model).toBe(responses.mock.results[0]?.value);
    expect(responses).toHaveBeenCalledWith("gpt-5");
    expect(chat).not.toHaveBeenCalled();
  });
});

describe("extra passthrough", () => {
  it("merges extra_body into JSON and extra headers into requests", async () => {
    const fetch = vi.fn(async (_input: Request | URL | string, init?: RequestInit) => new Response(JSON.stringify({ init })));
    const wrapped = withExtra(fetch, { temperature: 0.2 }, { headers: { "x-trace": "yes" } });
    await wrapped("https://example.test", { method: "POST", headers: { authorization: "Bearer test" }, body: JSON.stringify({ model: "m" }) });
    const init = fetch.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({ model: "m", temperature: 0.2 });
    expect(new Headers(init?.headers).get("x-trace")).toBe("yes");
  });
});

describe("ModelSet", () => {
  it("falls back by role, reports failover, and supports swap/currentSelection", async () => {
    const primaryError = Object.assign(new Error("rate limited"), { statusCode: 429 });
    const primary = mockModel("openai", "primary", vi.fn().mockRejectedValue(primaryError));
    const fallback = mockModel("anthropic", "fallback");
    const swapped = mockModel("openai", "swapped");
    const models = new Map([
      ["openai/primary", primary],
      ["anthropic/fallback", fallback],
      ["openai/swapped", swapped],
    ]);
    const set = new ModelSet({ provider: "openai", model: "primary", providers: { openai: {}, anthropic: {} }, roles: { writer: { provider: "openai", model: "primary", fallbacks: [{ provider: "anthropic", model: "fallback" }] } } }, (provider, model) => models.get(`${provider}/${model}`)!);
    expect(set.forRole("editor")).toBe(primary);
    const report = vi.fn();
    await set.forRoleWithFailover("writer", report).doGenerate({} as never);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ role: "writer", reason: "rate_limit", fromProvider: "openai", toProvider: "anthropic" }));
    expect(set.currentSelection("editor")).toEqual({ provider: "openai", model: "primary", explicit: false });
    await set.swap("editor", "openai", "swapped");
    expect(set.forRole("editor")).toBe(swapped);
    expect(set.currentSelection("editor")).toEqual({ provider: "openai", model: "swapped", explicit: true });
  });
});
