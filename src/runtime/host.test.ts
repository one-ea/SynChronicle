import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ReflectiveExecutor, type ReflectionExecutionState } from "../agents/reflection/index.js";
import { Store } from "../store/index.js";
import { createMemoryDatabaseStore } from "../store/database/index.js";
import { Host, type RuntimeAgent, type RuntimeObserver } from "./host.js";

function agent(outputs: string[] = []): RuntimeAgent {
  return {
    run: vi.fn(async function* () {
      for (const output of outputs) yield output;
    }),
    abort: vi.fn(),
    close: vi.fn(),
  };
}

async function host(outputs: string[] = []) {
  const dir = await mkdtemp(join(tmpdir(), "runtime-host-"));
  const runtimeAgent = agent(outputs);
  const value = await Host.new({ provider: "mock", model: "mock", providers: { mock: { api_key: "test" } }, roles: {}, output_dir: dir }, {}, { agent: runtimeAgent });
  return { value, runtimeAgent, dir };
}

describe("Host", () => {
  it("reports agent and durable commit boundaries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "runtime-host-boundaries-"));
    const store = new Store(dir);
    await store.init();
    const staging = await store.staging.createSession("boundary-test");
    const artifact = await staging.stage(1, { target: "chapters/01.md", content: "chapter" });
    const boundaries: string[] = [];
    const runtimeAgent: RuntimeAgent = {
      run: async function* () { await store.commitStaged(staging, [artifact.id]); },
      abort: vi.fn(),
      close: vi.fn(),
    };
    const value = await Host.new({ provider: "mock", model: "mock", providers: { mock: { api_key: "test" } }, roles: {}, output_dir: dir }, {}, { agent: runtimeAgent, store });
    value.setBoundaryHandler(async (boundary) => { boundaries.push(boundary); });

    await value.startPrepared("write");

    expect(boundaries).toEqual(["agent", "commit:enter", "commit:exit", "agent"]);
  });

  it("deduplicates lifecycle events with stable IDs after recovery", async () => {
    const dir = await mkdtemp(join(tmpdir(), "runtime-host-lifecycle-"));
    const store = new Store(dir);
    const config = { provider: "mock", model: "mock", providers: { mock: { api_key: "test" } }, roles: {}, output_dir: dir } as const;
    const first = await Host.new(config, {}, { agent: agent(), store });
    await first.startPrepared("write");
    await first.close();
    const second = await Host.new(config, {}, { agent: agent(), store });
    await second.startPrepared("write");
    await second.close();

    const lifecycle = (await store.runtime.loadQueue()).filter((item) => (item.payload as { id?: string })?.id?.startsWith("lifecycle:"));
    expect(lifecycle.map((item) => item.summary)).toEqual(["启动创作", "运行完成"]);
  });

  it("deduplicates repeated error lifecycle events with a stable ID", async () => {
    const dir = await mkdtemp(join(tmpdir(), "runtime-host-error-lifecycle-"));
    const store = new Store(dir);
    const config = { provider: "mock", model: "mock", providers: { mock: { api_key: "test" } }, roles: {}, output_dir: dir } as const;
    const failing = (): RuntimeAgent => ({ run: async function* () { throw new Error("provider failed"); }, abort: vi.fn(), close: vi.fn() });
    const first = await Host.new(config, {}, { agent: failing(), store });
    await expect(first.startPrepared("write")).rejects.toThrow("provider failed");
    await first.close();
    const second = await Host.new(config, {}, { agent: failing(), store });
    await expect(second.startPrepared("write")).rejects.toThrow("provider failed");
    await second.close();

    const errors = (await store.runtime.loadQueue()).filter((item) => item.category === "ERROR");
    expect(errors).toHaveLength(1);
    expect((errors[0]?.payload as { id?: string }).id).toMatch(/^lifecycle:.*:error:/);
  });

  it("registers an injected agent observer once across multiple runs", async () => {
    const setObserver = vi.fn();
    const runtimeAgent = { ...agent(), setObserver };
    const dir = await mkdtemp(join(tmpdir(), "runtime-host-observer-"));
    const value = await Host.new({ provider: "mock", model: "mock", providers: { mock: { api_key: "test" } }, roles: {}, output_dir: dir }, {}, { agent: runtimeAgent });

    await value.startPrepared("first");
    await value.continue("second");

    expect(setObserver).toHaveBeenCalledOnce();
  });

  it("publishes reflection events in order and records reviewer usage", async () => {
    let observer: RuntimeObserver | undefined;
    const runtimeAgent: RuntimeAgent = {
      setObserver: (value) => { observer = value; },
      run: vi.fn(async function* () {
        observer?.reflection({ type: "reflection.started", maxRounds: 2, agent: "writer" });
        observer?.reflection({ type: "review.completed", round: 1, score: 60, passed: false, agent: "writer" });
        observer?.reflection({ type: "revision.started", round: 2, issues: ["quality: revise"], agent: "writer" });
        observer?.usage("reviewer", { inputTokens: 12, outputTokens: 8 });
        observer?.reflection({ type: "review.completed", round: 2, score: 90, passed: true, agent: "writer" });
        observer?.reflection({ type: "reflection.completed", rounds: 2, score: 90, passed: true, agent: "writer" });
      }),
      abort: vi.fn(),
      close: vi.fn(),
    };
    const dir = await mkdtemp(join(tmpdir(), "runtime-host-reflection-"));
    const value = await Host.new({ provider: "mock", model: "mock", providers: { mock: { api_key: "test" } }, roles: {}, output_dir: dir }, {}, { agent: runtimeAgent });
    const events = value.events();

    await value.startPrepared("write");
    await value.close();
    const published = [];
    for await (const event of events) if (event.type === "reflection") published.push(event);

    expect(published.map((event) => event.message)).toEqual([
      "reflection.started",
      "review.completed",
      "revision.started",
      "review.completed",
      "reflection.completed",
    ]);
    expect(published.map((event) => (event.payload as { phase: string }).phase)).toEqual([
      "started",
      "review_completed",
      "revision_started",
      "review_completed",
      "completed",
    ]);
    expect(value.usage.snapshot().per_agent.reviewer?.input).toBeGreaterThan(0);
    expect(value.snapshot().reflection).toEqual({ round: 2, maxRounds: 2, score: 90, passed: true });
  });

  it("waits for queued event persistence before closing and preserves order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "runtime-host-close-"));
    const store = new Store(dir);
    await store.init();
    const original = store.runtime.appendQueue.bind(store.runtime);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(store.runtime, "appendQueue").mockImplementation(async (item) => { await gate; return original(item); });
    const value = await Host.new({ provider: "mock", model: "mock", providers: { mock: { api_key: "test" } }, roles: {}, output_dir: dir }, {}, { agent: agent(), store });

    await value.startPrepared("write");
    let closed = false;
    const closing = value.close().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    release();
    await closing;

    expect((await store.runtime.loadQueue()).filter((item) => item.kind === "ui_event").map((item) => item.summary)).toEqual(["启动创作", "运行完成"]);
  });

  it("closes resources and reports queued persistence failures", async () => {
    const dir = await mkdtemp(join(tmpdir(), "runtime-host-close-error-"));
    const store = new Store(dir);
    await store.init();
    vi.spyOn(store.runtime, "appendQueue").mockRejectedValue(new Error("queue write failed"));
    const runtimeAgent = agent();
    const value = await Host.new({ provider: "mock", model: "mock", providers: { mock: { api_key: "test" } }, roles: {}, output_dir: dir }, {}, { agent: runtimeAgent, store });
    await value.startPrepared("write");

    await expect(value.close()).rejects.toThrow("queue write failed");
    expect(runtimeAgent.close).toHaveBeenCalled();
    expect(value.snapshot().runtimeState).toBe("closed");
  });

  it("resumes reflection from round two and keeps the first candidate staged", async () => {
    const dir = await mkdtemp(join(tmpdir(), "runtime-host-reflection-resume-"));
    const store = new Store(dir);
    await store.init();
    const staging = await store.staging.createSession("writer-active");
    const firstArtifact = await staging.stage(1, { target: "chapters/01.md", content: "first draft" });
    const task = { objective: "write", constraints: [] };
    const review = { score: 60, passed: false, summary: "revise", issues: [{ dimension: "quality", severity: "high" as const, evidence: "weak", recommendation: "revise" }], revisionInstructions: ["revise"] };
    const state: ReflectionExecutionState<string> = {
      version: 1,
      executionId: "exec-resume",
      status: "running",
      task,
      nextRound: 2,
      candidates: [{ round: 1, output: "first", review, stagedArtifactIds: [firstArtifact.id] }],
      revisionInstructions: ["revise"],
      priorIssues: review.issues,
    };
    await store.staging.saveState("writer-execution", state);
    await store.progress.save({ novel_name: "Book", phase: "writing", current_chapter: 1, total_chapters: 1, completed_chapters: [], total_word_count: 0 });
    await store.runMeta.save({ started_at: new Date().toISOString(), provider: "mock", model: "mock", style: "", planning_tier: "short", steer_history: [], pending_steer: "", pause_point: null });
    const execute = vi.fn(async ({ round }: { round: number }) => ({ output: `round-${round}`, reviewContent: `round-${round}`, stagedArtifactIds: [] }));
    let observer: RuntimeObserver | undefined;
    const runtimeAgent: RuntimeAgent = {
      setObserver: (value) => { observer = value; },
      run: vi.fn(async function* () {
        await new ReflectiveExecutor({
          executionId: "exec-resume",
          role: "writer",
          maxRounds: 2,
          execute,
          reviewer: { review: async () => ({ ...review, score: 90, passed: true }) },
          stateStore: {
            load: () => store.staging.loadState<ReflectionExecutionState<string>>("writer-execution"),
            save: (next) => store.staging.saveState("writer-execution", next),
          },
          onEvent: (event) => observer?.reflection({ ...event, agent: "writer" }),
        }).execute(task);
      }),
      abort: vi.fn(),
      close: vi.fn(),
    };
    const value = await Host.new({ provider: "mock", model: "mock", providers: { mock: { api_key: "test" } }, roles: {}, output_dir: dir }, {}, { agent: runtimeAgent, store });

    await value.resume();

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ round: 2 }));
    expect(await staging.status(firstArtifact.id)).toBe("staged");
  });

  it("streams a prepared run and publishes lifecycle events", async () => {
    const { value, runtimeAgent } = await host(["hello", " world"]);
    const stream = value.stream();
    await value.startPrepared("write");
    expect(runtimeAgent.run).toHaveBeenCalledWith("write", expect.any(AbortSignal));
    const chunks: string[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    expect(chunks).toEqual(["hello", " world"]);
    expect(value.snapshot().runtimeState).toBe("completed");
    await expect(value.replayQueue(10)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ category: "SYSTEM" })]));
  });

  it("resumes progress and injects pending steer", async () => {
    const { value, runtimeAgent } = await host();
    await value.store.progress.save({ novel_name: "Book", phase: "writing", current_chapter: 2, total_chapters: 10, completed_chapters: [1, 2], total_word_count: 3456 });
    await value.store.runMeta.save({ started_at: new Date().toISOString(), provider: "mock", model: "mock", style: "", planning_tier: "short", steer_history: [], pending_steer: "make it darker", pause_point: null });
    const result = await value.resume();
    expect(result.label).toContain("第 3 章");
    expect(runtimeAgent.run).toHaveBeenCalledWith(expect.stringContaining("make it darker"), expect.any(AbortSignal));
  });

  it("supports continue, abort, and close lifecycle", async () => {
    const { value, runtimeAgent } = await host();
    await value.continue("next");
    value.abort("stop", "warn");
    await value.close();
    expect(runtimeAgent.abort).toHaveBeenCalledWith("stop");
    expect(runtimeAgent.close).toHaveBeenCalled();
    expect(value.snapshot().runtimeState).toBe("closed");
  });

  it("aborts the active run signal and prevents completion", async () => {
    let observedSignal: AbortSignal | undefined;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const runtimeAgent: RuntimeAgent = {
      run: async function* (_prompt, signal) { observedSignal = signal; started(); await new Promise<void>((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true })); yield "late"; },
      abort: vi.fn(),
      close: vi.fn(),
    };
    const dir = await mkdtemp(join(tmpdir(), "runtime-host-abort-signal-"));
    const value = await Host.new({ provider: "mock", model: "mock", providers: { mock: { api_key: "test" } }, roles: {}, output_dir: dir }, {}, { agent: runtimeAgent });
    const running = value.startPrepared("write");
    await ready;
    value.abort("cancelled");
    await expect(running).rejects.toThrow("cancelled");
    expect(observedSignal?.aborted).toBe(true);
    expect(value.snapshot().runtimeState).toBe("paused");
  });

  it("imports text, exports txt/epub, and runs simulation", async () => {
    const { value, dir } = await host();
    const source = join(dir, "source.txt");
    await writeFile(source, "第一章 开始\n正文一\n第二章 继续\n正文二");
    const imported = await value.importText(source);
    expect(imported.chapters).toBe(2);
    const txt = await value.export({ format: "txt" });
    const epub = await value.export({ format: "epub" });
    expect(txt.path).toMatch(/\.txt$/);
    expect(epub.path).toMatch(/\.epub$/);
    expect((await readFile(epub.path)).includes(Buffer.from("META-INF/container.xml"))).toBe(true);
    await expect(value.simulate({ sources: [source] })).resolves.toMatchObject({ sources: 1 });
  });

  it("requires an explicit export path for a database store", async () => {
    const dir = await mkdtemp(join(tmpdir(), "runtime-host-database-export-"));
    const store = createMemoryDatabaseStore({ userId: crypto.randomUUID(), projectId: crypto.randomUUID(), runId: crypto.randomUUID() });
    await store.progress.save({ novel_name: "Book", phase: "complete", current_chapter: 2, total_chapters: 1, completed_chapters: [1], total_word_count: 7 });
    await store.drafts.saveFinalChapter(1, "chapter");
    const value = await Host.new({ provider: "mock", model: "mock", providers: { mock: { api_key: "test" } }, roles: {}, output_dir: dir }, {}, { agent: agent(), store });
    await expect(value.export({ format: "txt" })).rejects.toThrow("explicit export path");
    await expect(value.export({ format: "txt", path: join(dir, "book.txt") })).resolves.toMatchObject({ chapters: 1 });
  });
});
