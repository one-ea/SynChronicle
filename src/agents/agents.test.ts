import { simulateReadableStream, type LanguageModel } from "ai";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Config } from "../config/index.js";
import type { Bundle } from "../domain/index.js";
import { ModelSet } from "../providers/index.js";
import { Store } from "../store/index.js";
import { normalizeUsage, UsageTracker } from "../runtime/usage.js";
import { buildCoordinator, commitReflectionCandidate, coordinateReflectionRecovery, recoverReflectionCommit } from "./build.js";
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

  it("merges only the selected reflected candidate into public history", async () => {
    const model = mockModel({
      generate: vi.fn()
        .mockResolvedValueOnce(generated("discarded"))
        .mockResolvedValueOnce(generated("selected")),
    });
    const executor = {
      execute: async (_task: unknown, generate: (prompt: string) => Promise<ReturnType<typeof generated>>) => {
        await generate("round one");
        return { output: await generate("round two") };
      },
    };
    const agent = createAgent({ name: "writer", model, system: "system", executor: executor as never });

    await agent.generate("objective");

    expect(agent.messages()).toEqual([
      { role: "user", content: "objective" },
      { role: "assistant", content: "selected" },
    ]);
  });

  it("preserves quality risk as side-channel metadata without changing generate output", async () => {
    const model = mockModel({ generate: async () => generated("candidate") });
    const risk = { code: "quality_threshold_unmet", score: 70, unresolvedIssues: [] };
    const executor = { execute: async (_task: unknown, generate: (prompt: string) => Promise<ReturnType<typeof generated>>) => ({ output: await generate("round"), rounds: 1, qualityRisk: risk }) };
    const agent = createAgent({ name: "writer", model, system: "system", executor: executor as never });

    const result = await agent.generate("objective");

    expect(result.text).toBe("candidate");
    expect(agent.reflectionMetadata()).toMatchObject({ status: "completed", qualityRisk: risk, rounds: 1 });
  });

  it("restores the history snapshot when reflected execution fails", async () => {
    const model = mockModel({ generate: async () => generated("discarded") });
    const executor = { execute: async (_task: unknown, generate: (prompt: string) => Promise<ReturnType<typeof generated>>) => { await generate("round"); throw new Error("review failed"); } };
    const agent = createAgent({ name: "writer", model, system: "system", executor: executor as never });

    await expect(agent.generate("objective")).rejects.toThrow("review failed");

    expect(agent.messages()).toEqual([]);
  });

  it("clears stale reflection metadata when a new execution starts and records failure status", async () => {
    const model = mockModel({ generate: async () => generated("candidate") });
    let fail = false;
    const executor = { execute: async (_task: unknown, generate: (prompt: string) => Promise<ReturnType<typeof generated>>) => { if (fail) throw new Error("failed"); return { output: await generate("round"), rounds: 1 }; } };
    const agent = createAgent({ name: "writer", model, system: "system", executor: executor as never });
    await agent.generate("first");
    fail = true;

    await expect(agent.generate("second")).rejects.toThrow("failed");

    expect(agent.reflectionMetadata()).toMatchObject({ status: "failed" });
    expect(agent.reflectionMetadata()).not.toHaveProperty("rounds");
  });

  it("serializes concurrent reflected executions on the same agent", async () => {
    let active = 0;
    let maximum = 0;
    const executor = { execute: async (task: { objective: string }, generate: (prompt: string) => Promise<ReturnType<typeof generated>>) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const output = await generate(task.objective);
      active--;
      return { output };
    } };
    const agent = createAgent({ name: "writer", model: mockModel({ generate: async (options) => generated(JSON.stringify(options.prompt)) }), system: "system", executor: executor as never });

    await Promise.all([agent.generate("first"), agent.generate("second")]);

    expect(maximum).toBe(1);
    expect(agent.messages()).toHaveLength(4);
  });

  it("assigns distinct durable logical keys to independent calls", async () => {
    const logicalKeys: string[] = [];
    const agent = createAgent({
      name: "writer",
      model: mockModel({}),
      system: "system",
      nextInvocationId: async ({ logicalKey }) => {
        logicalKeys.push(logicalKey);
        return `invocation-${logicalKeys.length}`;
      },
    });

    await agent.generate("same prompt");
    await agent.generate("same prompt");

    expect(logicalKeys).toEqual(["writer:generate:1", "writer:generate:2"]);
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

  it("persists commit state and emits completion only after business artifacts are durable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "synchronicle-reflection-protocol-"));
    const store = new Store(dir);
    await store.init();
    const transaction = store.recordingTransaction();
    await transaction.store.drafts.saveDraft(1, "durable");
    const staging = await store.staging.createSession("protocol");
    const ids = await transaction.stage(staging, 1);
    const events: unknown[] = [];
    const completion = { type: "reflection.completed" as const, rounds: 1, score: 90, passed: true };

    await commitReflectionCandidate(store, staging, "writer", ids, completion, (event) => events.push(event));

    expect(await staging.loadState()).toEqual({ version: 1, phase: "completed", candidateIds: ids, completion });
    expect(events).toEqual([{ ...completion, agent: "writer" }]);
  });

  it("writes nothing when aborted before the durable commit phase", async () => {
    const dir = await mkdtemp(join(tmpdir(), "synchronicle-reflection-abort-before-commit-"));
    const store = new Store(dir);
    await store.init();
    const transaction = store.recordingTransaction();
    await transaction.store.drafts.saveDraft(1, "must not commit");
    await transaction.store.checkpoints.appendArtifact({ kind: "chapter", chapter: 1 }, "draft", "drafts/01.draft.md");
    const staging = await store.staging.createSession("abort-before-commit");
    const ids = await transaction.stage(staging, 1);
    const controller = new AbortController();
    controller.abort(new Error("cancel before durable commit"));
    const events: unknown[] = [];

    await expect(commitReflectionCandidate(store, staging, "writer", ids, { type: "reflection.completed", rounds: 1, score: 90, passed: true }, (event) => events.push(event), "exec", controller.signal)).rejects.toThrow("cancel before durable commit");

    expect(await staging.loadState()).toBeNull();
    expect(await store.drafts.loadDraft(1)).toBe("");
    expect(await store.checkpoints.all()).toEqual([]);
    expect(events).toEqual([]);
  });

  it("finishes the durable commit after cancellation arrives past the phase boundary", async () => {
    const dir = await mkdtemp(join(tmpdir(), "synchronicle-reflection-abort-after-commit-"));
    const store = new Store(dir);
    await store.init();
    const transaction = store.recordingTransaction();
    await transaction.store.drafts.saveDraft(1, "must finish");
    await transaction.store.checkpoints.appendArtifact({ kind: "chapter", chapter: 1 }, "draft", "drafts/01.draft.md");
    const staging = await store.staging.createSession("abort-after-commit");
    const ids = await transaction.stage(staging, 1);
    const controller = new AbortController();
    const originalSaveState = staging.saveState.bind(staging);
    vi.spyOn(staging, "saveState").mockImplementation(async (state) => {
      await originalSaveState(state);
      if ((state as { phase?: string }).phase === "committing") controller.abort(new Error("late cancel"));
    });
    const events: unknown[] = [];

    await commitReflectionCandidate(store, staging, "writer", ids, { type: "reflection.completed", rounds: 1, score: 90, passed: true }, (event) => events.push(event), "exec", controller.signal);

    expect(controller.signal.aborted).toBe(true);
    expect(await store.drafts.loadDraft(1)).toBe("must finish");
    expect(await store.checkpoints.all()).toHaveLength(1);
    expect((await staging.loadState<{ phase: string }>())?.phase).toBe("completed");
    expect(events).toHaveLength(1);
  });

  it("waits for completion persistence acknowledgement before marking the commit completed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "synchronicle-reflection-ack-"));
    const store = new Store(dir);
    await store.init();
    const staging = await store.staging.createSession("ack");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const completion = { type: "reflection.completed" as const, rounds: 1, score: 90, passed: true };
    const committing = commitReflectionCandidate(store, staging, "writer", [], completion, async () => gate);
    await vi.waitFor(async () => expect((await staging.loadState<{ phase: string }>())?.phase).toBe("committed"));
    release();
    await committing;
    expect((await staging.loadState<{ phase: string }>())?.phase).toBe("completed");
  });

  it("recovers a persisted in-flight reflection commit before emitting completion", async () => {
    const dir = await mkdtemp(join(tmpdir(), "synchronicle-reflection-recovery-"));
    const store = new Store(dir);
    await store.init();
    const transaction = store.recordingTransaction();
    await transaction.store.drafts.saveDraft(1, "recovered");
    const staging = await store.staging.createSession("recovery");
    const ids = await transaction.stage(staging, 1);
    const completion = { type: "reflection.completed" as const, rounds: 2, score: 88, passed: true };
    await staging.saveState({ version: 1, phase: "committing", candidateIds: ids, completion });
    const events: unknown[] = [];

    await recoverReflectionCommit(store, staging, "writer", (event) => events.push(event));

    expect(await store.drafts.loadDraft(1)).toBe("recovered");
    expect(await staging.loadState()).toEqual({ version: 1, phase: "completed", candidateIds: ids, completion });
    expect(events).toEqual([{ ...completion, agent: "writer" }]);
  });

  it("isolates completion observer failures and retries pending event delivery idempotently", async () => {
    const dir = await mkdtemp(join(tmpdir(), "synchronicle-reflection-event-retry-"));
    const store = new Store(dir);
    await store.init();
    const transaction = store.recordingTransaction();
    await transaction.store.drafts.saveDraft(1, "committed");
    const staging = await store.staging.createSession("event-retry");
    const ids = await transaction.stage(staging, 1);
    const completion = { type: "reflection.completed" as const, rounds: 1, score: 90, passed: true };

    await expect(commitReflectionCandidate(store, staging, "writer", ids, completion, () => { throw new Error("observer down"); })).resolves.toBeUndefined();
    const events: unknown[] = [];
    await recoverReflectionCommit(store, staging, "writer", (event) => events.push(event));
    await recoverReflectionCommit(store, staging, "writer", (event) => events.push(event));

    expect(await store.drafts.loadDraft(1)).toBe("committed");
    expect(events).toEqual([{ ...completion, agent: "writer" }]);
  });

  it("advances selected execution after completed commit without recommit or event replay", async () => {
    const dir = await mkdtemp(join(tmpdir(), "synchronicle-reflection-completed-window-"));
    const store = new Store(dir);
    await store.init();
    const staging = await store.staging.createSession("completed-window");
    const completion = { type: "reflection.completed" as const, rounds: 1, score: 90, passed: true };
    await staging.saveState({ version: 1, phase: "completed", candidateIds: ["artifact-1"], completion, executionId: "exec-window" });
    const selectedResult = { executionId: "exec-window", output: generated("selected"), rounds: 1, finalReview: { score: 90, passed: true, summary: "ok", issues: [], revisionInstructions: [] }, stagedArtifactIds: ["artifact-1"] };
    await store.staging.saveState("writer-execution", { version: 1, executionId: "exec-window", status: "selected", task: { objective: "write", constraints: [] }, nextRound: 2, candidates: [], revisionInstructions: [], priorIssues: [], selectedResult });
    const events: unknown[] = [];

    const resumed = await coordinateReflectionRecovery(store, staging, "writer-execution", { objective: "write", constraints: [] }, "writer", (event) => events.push(event));

    expect(resumed).toEqual(selectedResult);
    expect((await store.staging.loadState<{ status: string }>("writer-execution"))?.status).toBe("completed");
    expect(events).toEqual([]);
  });

  it("does not return or advance a completed result for a different current task", async () => {
    const dir = await mkdtemp(join(tmpdir(), "synchronicle-reflection-task-mismatch-"));
    const store = new Store(dir);
    await store.init();
    const staging = await store.staging.createSession("task-mismatch");
    const completion = { type: "reflection.completed" as const, rounds: 1, score: 90, passed: true };
    await staging.saveState({ version: 1, phase: "completed", candidateIds: ["artifact-a"], completion, executionId: "exec-a" });
    const selectedResult = { executionId: "exec-a", output: generated("A"), rounds: 1, finalReview: { score: 90, passed: true, summary: "ok", issues: [], revisionInstructions: [] }, stagedArtifactIds: ["artifact-a"] };
    await store.staging.saveState("writer-execution", { version: 1, executionId: "exec-a", status: "selected", task: { objective: "task A", constraints: ["A"] }, nextRound: 2, candidates: [], revisionInstructions: [], priorIssues: [], selectedResult });

    await expect(coordinateReflectionRecovery(store, staging, "writer-execution", { objective: "task B", constraints: ["B"] }, "writer")).rejects.toThrow("does not match persisted reflection task");

    expect((await store.staging.loadState<{ status: string }>("writer-execution"))?.status).toBe("selected");
  });

  it("diagnoses invalid reflection commit state versions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "synchronicle-reflection-commit-schema-"));
    const store = new Store(dir);
    await store.init();
    const staging = await store.staging.createSession("invalid-version");
    await staging.saveState({ version: 2, phase: "committed", candidateIds: [], completion: { type: "reflection.completed", rounds: 1, score: 90, passed: true } });
    await expect(recoverReflectionCommit(store, staging, "writer")).rejects.toThrow(/commit state schema\/version invalid/);
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

  it("stops before reviewer when hard-stop budget ends after candidate execution", async () => {
    const dir = await mkdtemp(join(tmpdir(), "synchronicle-reflection-budget-"));
    const store = new Store(dir);
    await store.init();
    const config: Config = {
      provider: "mock",
      model: "mock-model",
      providers: { mock: { type: "openai", api_key: "test" } },
      roles: {},
      budget: { book_usd: 1, hard_stop: true },
      reflection: { enabled: true, max_rounds: 3, pass_threshold: 85 },
    };
    let calls = 0;
    const model = mockModel({
      generate: async () => {
        calls++;
        return calls === 1
          ? generated("first candidate")
          : generated(JSON.stringify({ score: 70, passed: false, summary: "revise", issues: [], revisionInstructions: ["improve"] }));
      },
    });
    const hasBudget = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    const built = buildCoordinator(config, store, new ModelSet(config, () => model), { prompts: {} }, undefined, undefined, undefined, undefined, undefined, hasBudget);

    await expect(built.agents.writer.generate("write")).rejects.toThrow(/before any candidate was reviewed/);
    expect(calls).toBe(1);
    expect(built.agents.writer.reflectionMetadata()).toMatchObject({ status: "failed" });
    expect(hasBudget).toHaveBeenCalledTimes(2);
  });

  it("uses priced standard provider usage to trigger the hard-stop budget", async () => {
    const dir = await mkdtemp(join(tmpdir(), "synchronicle-reflection-priced-budget-"));
    const store = new Store(dir);
    await store.init();
    const config: Config = {
      provider: "openai",
      model: "gpt-5-mini",
      providers: { openai: { api_key: "test" } },
      roles: {},
      budget: { book_usd: 0.1, hard_stop: true },
      reflection: { enabled: true, max_rounds: 2 },
    };
    let calls = 0;
    const model = { ...mockModel({ generate: async () => { calls++; return { ...generated("candidate"), usage: { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 } }; } }), provider: "openai", modelId: "gpt-5-mini" };
    const tracker = new UsageTracker();
    const built = buildCoordinator(
      config,
      store,
      new ModelSet(config, () => model),
      { prompts: {} },
      (agent, usage, identity) => tracker.record(agent, normalizeUsage(usage, identity)),
      undefined,
      undefined,
      undefined,
      undefined,
      () => tracker.snapshot().overall.cost_usd < 0.1,
    );

    await expect(built.agents.writer.generate("write")).rejects.toThrow(/before any candidate was reviewed/);

    expect(calls).toBe(1);
    expect(tracker.snapshot().overall.cost_usd).toBeCloseTo(0.25);
    expect(tracker.snapshot().per_agent.writer?.cost_usd).toBeCloseTo(0.25);
    expect(tracker.snapshot().per_model?.["openai/gpt-5-mini"]?.cost_usd).toBeCloseTo(0.25);
  });
});
