import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Host, type RuntimeAgent } from "./host.js";

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
