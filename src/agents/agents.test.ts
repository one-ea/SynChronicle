import { simulateReadableStream, type LanguageModel } from "ai";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Config } from "../config/index.js";
import type { Bundle } from "../domain/index.js";
import { ModelSet } from "../providers/index.js";
import { Store } from "../store/index.js";
import { buildCoordinator } from "./build.js";
import { ContextManager } from "./context.js";
import { createAgent } from "./agent.js";
import { packArchitect, packCoordinator, packEditor, packWriter } from "./ctxpack/index.js";

function generated(text: string) {
  return {
    finishReason: "stop" as const,
    usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    content: [{ type: "text" as const, text }],
    warnings: [],
  };
}

type LanguageModelInstance = Exclude<LanguageModel, string>;

function mockModel(options: {
  generate?: LanguageModelInstance["doGenerate"];
  stream?: LanguageModelInstance["doStream"];
}): LanguageModelInstance {
  return {
    specificationVersion: "v2",
    provider: "mock",
    modelId: "mock-model",
    supportedUrls: {},
    doGenerate: options.generate ?? (async () => generated("ok")),
    doStream: options.stream ?? vi.fn(),
  };
}

describe("Agent", () => {
  it("uses AI SDK generateText and keeps independent context", async () => {
    const calls: unknown[] = [];
    const model = mockModel({
      generate: async (options) => {
        calls.push(options.prompt);
        return generated("ok");
      },
    });
    const first = createAgent({ name: "first", model, system: "first-system" });
    const second = createAgent({ name: "second", model, system: "second-system" });

    await first.generate("alpha");
    await second.generate("beta");

    expect(first.messages()).toHaveLength(2);
    expect(second.messages()).toHaveLength(2);
    expect(JSON.stringify(calls[0])).toContain("alpha");
    expect(JSON.stringify(calls[0])).not.toContain("beta");
    expect(JSON.stringify(calls[1])).toContain("beta");
  });

  it("uses AI SDK streamText and records the completed response", async () => {
    const model = mockModel({
      stream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: "streamed" },
            { type: "text-end", id: "text-1" },
            { type: "finish", finishReason: "stop", logprobs: undefined, usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 } },
          ],
        }),
      }),
    });
    const agent = createAgent({ name: "streamer", model, system: "system" });

    const result = agent.stream("go");
    let text = "";
    for await (const delta of result.textStream) text += delta;
    await result.completed;

    expect(text).toBe("streamed");
    expect(agent.messages().at(-1)).toEqual({ role: "assistant", content: "streamed" });
  });

  it("runs reflected streaming once and emits only the final candidate", async () => {
    const direct = vi.fn()
      .mockResolvedValueOnce({ text: "draft" })
      .mockResolvedValueOnce({ text: "final" });
    const executor = {
      execute: vi.fn(async (_task, generate) => {
        await generate("first");
        return { output: await generate("revision"), rounds: 2, finalReview: { score: 90, passed: true, summary: "ok", issues: [], revisionInstructions: [] } };
      }),
    };
    const agent = createAgent({ name: "writer", model: mockModel({}), system: "system", executor: executor as never });
    Object.defineProperty(agent, "generateDirect", { value: direct });

    const streamed = agent.stream("write");
    let text = "";
    for await (const delta of streamed.textStream) text += delta;

    expect(text).toBe("final");
    expect((await streamed.completed).text).toBe("final");
    expect(executor.execute).toHaveBeenCalledOnce();
    expect(direct).toHaveBeenCalledTimes(2);
  });
});

describe("ContextManager", () => {
  it("estimates tokens and compresses at 85 percent while reserving at least 8000", async () => {
    const manager = new ContextManager({ window: 10000 });
    const messages = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 ? "assistant" as const : "user" as const,
      content: "x ".repeat(1200),
    }));

    expect(manager.threshold).toBe(8500);
    expect(manager.reserve).toBe(8000);
    expect(manager.estimate(messages)).toBeGreaterThan(manager.threshold);
    const compressed = await manager.compress(messages);
    expect(manager.estimate(compressed)).toBeLessThanOrEqual(manager.reserve);
    expect(compressed.at(-1)).toEqual(messages.at(-1));
  });

  it("uses 15 percent reserve for large windows", () => {
    expect(new ContextManager({ window: 100000 }).reserve).toBe(15000);
  });
});

describe("context packs", () => {
  it("labels role-specific context without sharing mutable data", () => {
    const source = { progress: { chapter: 3 }, memory: ["a"] };
    const packs = [packCoordinator(source), packArchitect(source), packWriter(source), packEditor(source)];
    expect(packs.map((pack) => pack.consumer)).toEqual(["coordinator", "architect", "writer", "editor"]);
    expect(new Set(packs.map((pack) => pack))).toHaveLength(4);
  });
});

describe("buildCoordinator", () => {
  it("builds callable role agents with prompt and tool isolation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "synchronicle-agents-"));
    const store = new Store(dir);
    await store.init();
    const config: Config = {
      provider: "mock",
      model: "mock-model",
      context_window: 20000,
      providers: { mock: { type: "openai", api_key: "test" } },
      roles: {},
      style: "default",
    };
    const model = mockModel({ generate: async () => generated("ready") });
    const models = new ModelSet(config, () => model);
    const bundle: Bundle = {
      prompts: {
        coordinator: "coordinator prompt",
        "architect-short": "short prompt",
        "architect-long": "long prompt",
        writer: "writer prompt",
        editor: "editor prompt",
      },
      styles: { default: "style prompt" },
    };
    const recordUsage = vi.fn();
    const built = buildCoordinator(config, store, models, bundle, recordUsage);

    expect(Object.keys(built.agents).sort()).toEqual(["architect_long", "architect_short", "coordinator", "editor", "writer"]);
    expect(built.agents.architect_short.toolNames()).toEqual(["novel_context", "save_foundation"]);
    expect(built.agents.writer.toolNames()).toEqual(expect.arrayContaining(["plan_chapter", "draft_chapter", "commit_chapter"]));
    expect(built.agents.editor.toolNames()).toEqual(expect.arrayContaining(["save_review", "save_arc_summary", "save_volume_summary"]));
    await built.coordinator.generate("start");
    expect(recordUsage).toHaveBeenCalledOnce();
    expect(built.coordinatorCtxMgr.reserve).toBe(8000);
  });

  it("wraps specialist agents and keeps coordinator direct", async () => {
    const dir = await mkdtemp(join(tmpdir(), "synchronicle-reflection-build-"));
    const store = new Store(dir);
    await store.init();
    const config: Config = {
      provider: "mock",
      model: "mock-model",
      providers: { mock: { type: "openai", api_key: "test" } },
      roles: {},
      reflection: { enabled: true },
    };
    const models = new ModelSet(config, () => mockModel({}));
    const built = buildCoordinator(config, store, models, { prompts: {} });

    expect(built.agents.coordinator.reflectionEnabled).toBe(false);
    expect(built.agents.architect_short.reflectionEnabled).toBe(true);
    expect(built.agents.architect_long.reflectionEnabled).toBe(true);
    expect(built.agents.writer.reflectionEnabled).toBe(true);
    expect(built.agents.editor.reflectionEnabled).toBe(true);
  });
});
