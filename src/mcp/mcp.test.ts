import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMcpHandler, type McpMessage } from "./index.js";

async function seed(directory: string): Promise<string> {
  const output = join(directory, "novel");
  for (const dir of ["meta", "chapters", "summaries", "reviews"]) await mkdir(join(output, dir), { recursive: true });
  await writeFile(join(output, "meta", "progress.json"), JSON.stringify({ novel_name: "测试书", phase: "writing", current_chapter: 2, total_chapters: 3, completed_chapters: [1], total_word_count: 10, chapter_word_counts: { "1": 10 }, in_progress_chapter: 0, flow: "writing", strand_history: ["主线", "主线", "主线", "主线", "主线", "主线"], pending_rewrites: [] }));
  await writeFile(join(output, "chapters", "01.md"), "他不禁皱起了眉，仿佛潮水一般。");
  await writeFile(join(output, "summaries", "01.json"), JSON.stringify({ chapter: 1, summary: "发现信号", characters: [], key_events: ["坐标"] }));
  await writeFile(join(output, "outline.json"), JSON.stringify([{ chapter: 1, title: "开端", core_event: "e", hook: "h", scenes: [] }, { chapter: 2, title: "发展", core_event: "e2", hook: "", scenes: [] }]));
  const configPath = join(directory, "config.json");
  await writeFile(configPath, JSON.stringify({ provider: "ollama", model: "qwen3:14b", providers: { ollama: { base_url: "http://localhost:11434/v1" } }, output_dir: output }));
  return configPath;
}

function request(id: number, method: string, params?: Record<string, unknown>): McpMessage {
  return { jsonrpc: "2.0", id, method, params };
}

describe("mcp handler", () => {
  it("handshakes, lists six tools, answers ping, and rejects unknown methods", async () => {
    const handler = createMcpHandler({ configPath: "/tmp/synchronicle-mcp-missing.json" });
    const init = (await handler(request(1, "initialize", { protocolVersion: "2025-06-18" }))) as { result: { protocolVersion: string; capabilities: { tools: unknown }; serverInfo: { name: string } } };
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.capabilities.tools).toEqual({});
    expect(init.result.serverInfo.name).toBe("synchronicle");
    expect(await handler({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined();
    expect(((await handler(request(2, "ping"))) as { result: object }).result).toEqual({});
    const tools = (await handler(request(3, "tools/list"))) as { result: { tools: Array<{ name: string }> } };
    expect(tools.result.tools.map((tool) => tool.name).sort()).toEqual(["synchronicle_book", "synchronicle_chapter", "synchronicle_diag", "synchronicle_inject", "synchronicle_run", "synchronicle_status", "synchronicle_steer"].sort());
    const unknown = (await handler(request(4, "no/such/method"))) as { error: { code: number } };
    expect(unknown.error.code).toBe(-32601);
  });

  it("serves read tools from a seeded store", async () => {
    const directory = await mkdtemp(join(tmpdir(), "synchronicle-mcp-"));
    const configPath = await seed(directory);
    try {
      const handler = createMcpHandler({ configPath });
      const status = toolText(await handler(request(1, "tools/call", { name: "synchronicle_status" })));
      expect(status).toContain('"configured": true');
      expect(status).toContain('"completedChapters": 1');
      const book = toolText(await handler(request(2, "tools/call", { name: "synchronicle_book" })));
      expect(book).toContain("测试书");
      expect(book).toContain('"status": "completed"');
      const chapter = toolText(await handler(request(3, "tools/call", { name: "synchronicle_chapter", arguments: { chapter: 1 } })));
      expect(chapter).toContain("不禁");
      expect(chapter).toContain('"aitone"');
      const diag = toolText(await handler(request(4, "tools/call", { name: "synchronicle_diag" })));
      expect(diag).toContain("PacingStall");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns tool-level errors for invalid arguments", async () => {
    const directory = await mkdtemp(join(tmpdir(), "synchronicle-mcp-"));
    const configPath = await seed(directory);
    try {
      const handler = createMcpHandler({ configPath });
      const bad = (await handler(request(1, "tools/call", { name: "synchronicle_chapter", arguments: { chapter: 0 } }))) as { result: { isError: boolean; content: Array<{ text: string }> } };
      expect(bad.result.isError).toBe(true);
      expect(bad.result.content[0]!.text).toContain("正整数");
      const emptyPrompt = (await handler(request(2, "tools/call", { name: "synchronicle_run", arguments: { prompt: "  " } }))) as { result: { isError: boolean } };
      expect(emptyPrompt.result.isError).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("writes Host-compatible injections and starts runs through a mock host", async () => {
    const directory = await mkdtemp(join(tmpdir(), "synchronicle-mcp-"));
    const configPath = await seed(directory);
    const calls: string[] = [];
    try {
      const handler = createMcpHandler({
        configPath,
        host: {
          startPrepared: async (prompt) => { calls.push(`start:${prompt}`); },
          continue: async (prompt) => { calls.push(`continue:${prompt}`); },
          steer: async (options) => { calls.push(`steer:${options.prompt}`); return { aborted: false, targetChapter: options.targetChapter ?? 1 }; },
          snapshot: () => ({ runtimeState: "idle" }),
        },
      });
      const inject = toolText(await handler(request(1, "tools/call", { name: "synchronicle_inject", arguments: { text: "节奏放慢一点" } })));
      expect(inject).toContain("已注入");
      const raw = JSON.parse((await readFile(join(directory, "novel", "meta", "injections.jsonl"), "utf8")).trim());
      expect(raw.text).toBe("节奏放慢一点");
      expect(typeof raw.time).toBe("string");
      const run = toolText(await handler(request(2, "tools/call", { name: "synchronicle_run", arguments: { prompt: "写第二章" } })));
      expect(run).toContain('"started": true');
      expect(calls).toEqual(["start:写第二章"]);

      const steer = toolText(await handler(request(3, "tools/call", { name: "synchronicle_steer", arguments: { prompt: "重写这章，加入悬念" } })));
      expect(steer).toContain('"success": true');
      expect(calls).toEqual(["start:写第二章", "steer:重写这章，加入悬念"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports unconfigured state for read tools and action tools", async () => {
    const handler = createMcpHandler({ configPath: "/tmp/synchronicle-mcp-missing.json" });
    expect(toolText(await handler(request(1, "tools/call", { name: "synchronicle_status" })))).toContain("configured: false");
    const run = (await handler(request(2, "tools/call", { name: "synchronicle_run", arguments: { prompt: "x" } }))) as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(run.result.isError).toBe(true);
    expect(run.result.content[0]!.text).toContain("配置");
  });
});

function toolText(response: unknown): string {
  const result = (response as { result: { content: Array<{ text: string }> } }).result;
  return result.content[0]!.text;
}
