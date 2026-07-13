import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ReflectiveExecutor, type ReflectionExecutionState } from "../agents/reflection/index.js";
import { Store } from "../store/index.js";
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
  it("publishes reflection events in order and records reviewer usage", async () => {
    let observer: RuntimeObserver | undefined;
    const runtimeAgent: RuntimeAgent = {
      observe: (value) => { observer = value; },
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
      observe: (value) => { observer = value; },
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
    expect(runtimeAgent.run).toHaveBeenCalledWith("write");
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
    expect(runtimeAgent.run).toHaveBeenCalledWith(expect.stringContaining("make it darker"));
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
});
