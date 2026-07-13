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

  it("resolves the independent reviewer model from reflection config", () => {
    const primary = mockModel("openai", "primary");
    const reviewer = mockModel("openai", "reviewer");
    const factory = vi.fn((_provider: string, model: string) => model === "reviewer" ? reviewer : primary);
    const set = new ModelSet({
      provider: "openai",
      model: "primary",
      providers: { openai: {} },
      reflection: { reviewer_model: "reviewer" },
    }, factory);

    expect(set.forReviewer()).toBe(reviewer);
    expect(factory).toHaveBeenCalledWith("openai", "reviewer");
  });

  it("uses the default model when reviewer_model is omitted", () => {
    const primary = mockModel("openai", "primary");
    const set = new ModelSet({ provider: "openai", model: "primary", providers: { openai: {} } }, () => primary);

    expect(set.forReviewer()).toBe(primary);
  });

  it("resolves provider/model reviewer references with reviewer failover", async () => {
    const primary = mockModel("anthropic", "reviewer");
    primary.doGenerate = async () => { throw Object.assign(new Error("busy"), { statusCode: 429 }); };
    const fallback = mockModel("openai", "fallback");
    const factory = vi.fn((provider: string, _model: string) => provider === "anthropic" ? primary : fallback);
    const report = vi.fn();
    const set = new ModelSet({
      provider: "openai",
      model: "default",
      providers: { openai: {}, anthropic: {} },
      roles: { reviewer: { provider: "anthropic", model: "reviewer", fallbacks: [{ provider: "openai", model: "fallback" }] } },
      reflection: { reviewer_model: "anthropic/reviewer" },
    }, factory);

    const result = await set.forReviewer(report).doGenerate({} as never);

    expect(result).toEqual(expect.objectContaining({ content: expect.any(Array) }));
    expect(factory).toHaveBeenCalledWith("anthropic", "reviewer");
    expect(factory).toHaveBeenCalledWith("openai", "fallback");
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ role: "reviewer", reason: "rate_limit", fromProvider: "anthropic", toProvider: "openai" }));
  });
});
