import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderWebApp } from "./app.js";
import { renderReadApp } from "./read.js";
import { startWebServer } from "./server.js";

describe("WebUI", () => {
  it("renders a studio shell with a prompt and live status regions", () => {
    const html = renderWebApp();
    expect(html).toContain("SynChronicle");
    expect(html).toContain("创作概览");
    expect(html).toContain("data-testid=\"runtime-status\"");
    expect(html).toContain("/api/run");
    expect(html).toContain("data-testid=\"config-form\"");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('name="provider"');
    expect(html).toContain("--heat-100");
    expect(html).toContain("--btn-radius");
    expect(html).toContain('data-theme="system"');
    expect(html).toContain('data-page="reader"');
    expect(html).toContain('new EventSource');
    expect(html).toContain('role="tree"');
  });

  it("keeps first-run setup explicit and accessible", () => {
    const html = renderWebApp();
    expect(html).toContain("保存后即可开始创作");
    expect(html).toContain('label for="model-input"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("A room for long-form worlds");
  });

  it("exposes recovery and steering states without unsafe event rendering", () => {
    const html = renderWebApp();
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("发送干预");
    expect(html).toContain("恢复上一轮");
    expect(html).toContain("Ctrl / Cmd + Enter");
    expect(html).toContain('role="log"');
    expect(html).not.toContain("innerHTML =");
    expect(html).toContain("feed.replaceChildren()");
    expect(html).toContain("prefers-reduced-motion: reduce");
  });

  it("serves the WebUI and health endpoint without a model configuration", async () => {
    const handle = await startWebServer({ port: 0, configPath: "/tmp/synchronicle-test-missing-config.json" });
    try {
      const root = await fetch(`http://127.0.0.1:${handle.port}/`);
      expect(root.status).toBe(200);
      expect(await root.text()).toContain("SynChronicle");

      const health = await fetch(`http://127.0.0.1:${handle.port}/api/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true });

      const status = await fetch(`http://127.0.0.1:${handle.port}/api/status`);
      expect(status.status).toBe(200);
      expect(await status.json()).toMatchObject({ configured: false });
    } finally {
      await handle.close();
    }
  });

  it("saves a local provider configuration through the WebUI", async () => {
    const directory = await mkdtemp(join(tmpdir(), "synchronicle-web-config-"));
    const configPath = join(directory, "config.json");
    const handle = await startWebServer({ port: 0, configPath });
    try {
      const saved = await fetch(`http://127.0.0.1:${handle.port}/api/config`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "ollama", model: "qwen3:14b", baseUrl: "http://localhost:11434/v1" }),
      });
      expect(saved.status).toBe(201);
      expect(await saved.json()).toEqual({ configured: true });

      const status = await fetch(`http://127.0.0.1:${handle.port}/api/status`);
      expect(await status.json()).toMatchObject({ configured: true });
    } finally {
      await handle.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("serves book tree and chapter detail from a seeded store", async () => {
    const directory = await mkdtemp(join(tmpdir(), "synchronicle-web-book-"));
    const output = join(directory, "novel");
    for (const dir of ["meta", "chapters", "summaries", "reviews"]) await mkdir(join(output, dir), { recursive: true });
    await writeFile(join(output, "meta", "progress.json"), JSON.stringify({ novel_name: "测试书", phase: "writing", current_chapter: 2, total_chapters: 3, completed_chapters: [1], total_word_count: 10, chapter_word_counts: { "1": 10 }, in_progress_chapter: 2, flow: "writing", pending_rewrites: [] }));
    await writeFile(join(output, "chapters", "01.md"), "# 第一章\n\n正文内容");
    await writeFile(join(output, "summaries", "01.json"), JSON.stringify({ chapter: 1, summary: "主角登场", characters: [], key_events: ["发现线索"] }));
    await writeFile(join(output, "reviews", "01.json"), JSON.stringify({ chapter: 1, scope: "chapter", issues: [], dimensions: [{ dimension: "hook", score: 90, verdict: "pass", comment: "章末留钩" }], verdict: "pass", summary: "达标", affected_chapters: [] }));
    await writeFile(join(output, "outline.json"), JSON.stringify([{ chapter: 1, title: "开端", core_event: "e", hook: "h", scenes: [] }, { chapter: 2, title: "发展", core_event: "e2", hook: "", scenes: [] }]));
    const configPath = join(directory, "config.json");
    await writeFile(configPath, JSON.stringify({ provider: "ollama", model: "qwen3:14b", providers: { ollama: { base_url: "http://localhost:11434/v1" } }, output_dir: output }));
    const handle = await startWebServer({ port: 0, configPath });
    try {
      const json = async (path: string): Promise<any> => JSON.parse(await (await fetch(`http://127.0.0.1:${handle.port}${path}`)).text());
      const book = await json("/api/book");
      expect(book.configured).toBe(true);
      expect(book.book.novelName).toBe("测试书");
      const chapters = book.book.volumes[0].arcs[0].chapters;
      expect(chapters.map((chapter: { status: string }) => chapter.status)).toEqual(["completed", "in-progress"]);

      const detail = await json("/api/chapters/1");
      expect(detail.chapter.text).toContain("正文内容");
      expect(detail.chapter.source).toBe("final");
      expect(detail.chapter.summary.keyEvents).toEqual(["发现线索"]);
      expect(detail.chapter.review.dimensions[0].score).toBe(90);

      const pending = await json("/api/chapters/2");
      expect(pending.chapter.text).toBeNull();
      expect(pending.chapter.status).toBe("in-progress");

      const invalid = await fetch(`http://127.0.0.1:${handle.port}/api/chapters/0`);
      expect(invalid.status).toBe(400);
    } finally {
      await handle.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("streams snapshot as the first SSE event", async () => {
    const handle = await startWebServer({ port: 0, configPath: "/tmp/synchronicle-test-missing-config.json" });
    try {
      const response = await fetch(`http://127.0.0.1:${handle.port}/api/stream`);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      const reader = response.body!.getReader();
      const { value } = await reader.read();
      expect(Buffer.from(value!).toString()).toContain("event: snapshot");
      await reader.cancel();
    } finally {
      await handle.close();
    }
  });

  it("renders an emdash-style read front with chapter navigation", () => {
    const html = renderReadApp();
    expect(html).toContain("开始阅读");
    expect(html).toContain("返回控制台");
    expect(html).toContain("/api/book");
    expect(html).toContain("/api/chapters/");
    expect(html).toContain('data-theme="system"');
    expect(html).toContain("上一章");
    expect(html).toContain("下一章");
    expect(html).not.toContain("innerHTML =");
  });

  it("serves the read front without a model configuration", async () => {
    const handle = await startWebServer({ port: 0, configPath: "/tmp/synchronicle-test-missing-config.json" });
    try {
      const read = await fetch(`http://127.0.0.1:${handle.port}/read`);
      expect(read.status).toBe(200);
      expect(await read.text()).toContain("SynChronicle");
    } finally {
      await handle.close();
    }
  });
});
