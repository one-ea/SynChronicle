import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderWebApp } from "./app.js";
import { renderReadApp } from "./read.js";
import { startWebServer } from "./server.js";
import { crc32 } from "../domain/charcard_crc.js";

function makeTestCardPng(): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "latin1");
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "latin1"), data])) >>> 0, 0);
    return Buffer.concat([head, data, tail]);
  };
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = chunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]));
  const card = { spec: "chara_card_v2", data: { name: "沈砚", description: "雨夜书局掌柜", personality: "冷静" } };
  const text = chunk("tEXt", Buffer.concat([Buffer.from("chara\0", "latin1"), Buffer.from(Buffer.from(JSON.stringify(card), "utf8").toString("base64"), "latin1")]));
  const iend = chunk("IEND", Buffer.alloc(0));
  return Buffer.concat([signature, ihdr, text, iend]);
}

describe("WebUI", () => {
  it("renders a studio shell with a prompt and live status regions", () => {
    const html = renderWebApp();
    expect(html).toContain("SynChronicle");
    expect(html).toContain("创作概览");
    expect(html).toContain("data-testid=\"runtime-status\"");
    expect(html).toContain("/api/run");
    expect(html).toContain("data-testid=\"config-form\"");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('name="protocol-type"');
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

  it("renders the emdash-style token system and three-tier responsive shell", () => {
    const html = renderWebApp();
    expect(html).toContain("--radius: 14px");
    expect(html).toContain("--radius-lg: 18px");
    expect(html).toContain("--space-5: 24px");
    expect(html).toContain("(min-width: 768px) and (max-width: 1023px)");
    expect(html).toContain("(max-width: 767px)");
    expect(html).not.toContain("@media (max-width: 980px)");
    expect(html).not.toContain("@media (max-width: 860px)");
    expect(html).not.toContain("@media (max-width: 560px)");
    expect(html).toContain('class="tabbar"');
    expect(html).toContain('aria-label="移动端主导航"');
    const tabbarViews = ["overview", "reader", "entities", "records", "settings"];
    for (const view of tabbarViews) expect(html).toContain(`data-view="${view}" title=`);
    expect(Buffer.byteLength(html, "utf8")).toBeLessThan(148562 + 30 * 1024);
  });

  it("applies stitch draft refinements to the console shell", () => {
    const html = renderWebApp();
    expect(html).toContain("--font-mono");
    expect(html).toContain('class="nv-t"');
    expect(html).toContain('id="nav-count-chapters"');
    expect(html).toContain('id="nav-count-entities"');
    expect(html).toContain("<code>engine</code>");
    expect(html).toContain("<code>output</code>");
    expect(html).toContain("草稿自动归档");
    expect(html).toContain("inset 0 0 0 1px var(--heat-20)");
    expect(html).toContain("backdrop-filter: blur(14px)");
    expect(html).toContain(".card:hover { border-color: var(--line-strong); }");
  });

  it("adapts the read front with collapsible toc and fluid typography", () => {
    const html = renderReadApp();
    expect(html).toContain('class="card toc-card" id="r-toc"');
    expect(html).toContain("<summary");
    expect(html).toContain("max-width: 72ch");
    expect(html).toContain("clamp(15px, 2.5vw, 17px)");
    expect(html).toContain("(max-width: 767px)");
    expect(html).toContain("$('r-toc').removeAttribute('open')");
    expect(Buffer.byteLength(html, "utf8")).toBeLessThan(15070 + 30 * 1024);
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

  it("saves a custom provider configuration through the WebUI", async () => {
    const directory = await mkdtemp(join(tmpdir(), "synchronicle-web-config-"));
    const configPath = join(directory, "config.json");
    const handle = await startWebServer({ port: 0, configPath });
    try {
      const saved = await fetch(`http://127.0.0.1:${handle.port}/api/config`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "custom", type: "openai", model: "custom-model", baseUrl: "https://my-proxy.com/v1", apiKey: "test-key" }),
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
    await writeFile(configPath, JSON.stringify({ provider: "deepseek", model: "deepseek-chat", providers: { deepseek: { base_url: "https://api.deepseek.com/v1" } }, output_dir: output }));
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

  it("lists and commits staged reflection rounds", async () => {
    const directory = await mkdtemp(join(tmpdir(), "synchronicle-web-reflection-"));
    const output = join(directory, "novel");
    for (const dir of ["meta", "chapters", "meta/reflection/demo-session/round-1", "meta/reflection/demo-session/round-2"]) await mkdir(join(output, dir), { recursive: true });
    await writeFile(join(output, "chapters", "01.md"), "旧版正文");
    const first = "第一轮候选内容";
    const second = "第二轮更好的候选内容，足够具体。";
    await writeFile(join(output, "meta", "reflection", "demo-session", "round-1", "a.artifact"), first);
    await writeFile(join(output, "meta", "reflection", "demo-session", "round-2", "b.artifact"), second);
    await writeFile(join(output, "meta", "reflection", "demo-session", "manifest.json"), JSON.stringify({ sessionId: "demo-session", artifacts: [
      { id: "a", round: 1, target: "chapters/01.md", contentFile: "meta/reflection/demo-session/round-1/a.artifact", digest: `sha256:${createHash("sha256").update(first).digest("hex")}`, status: "committed" },
      { id: "b", round: 2, target: "chapters/01.md", contentFile: "meta/reflection/demo-session/round-2/b.artifact", digest: `sha256:${createHash("sha256").update(second).digest("hex")}`, status: "staged" },
    ] }));
    const configPath = join(directory, "config.json");
    await writeFile(configPath, JSON.stringify({ provider: "deepseek", model: "deepseek-chat", providers: { deepseek: { base_url: "https://api.deepseek.com/v1" } }, output_dir: output }));
    const handle = await startWebServer({ port: 0, configPath });
    try {
      const json = async (path: string): Promise<any> => JSON.parse(await (await fetch(`http://127.0.0.1:${handle.port}${path}`)).text());
      const list = await json("/api/reflection");
      expect(list.configured).toBe(true);
      expect(list.sessions).toHaveLength(1);
      const round2 = list.sessions[0].rounds.find((round: { round: number }) => round.round === 2);
      expect(round2.artifacts[0].preview).toContain("第二轮更好的候选");

      const committed = await (await fetch(`http://127.0.0.1:${handle.port}/api/reflection/commit`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: "demo-session", round: 2 }),
      })).json();
      expect(committed).toEqual({ committed: 1 });
      const text = await readFile(join(output, "chapters", "01.md"), "utf8");
      expect(text).toContain("第二轮更好的候选");

      const again = await fetch(`http://127.0.0.1:${handle.port}/api/reflection/commit`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: "demo-session", round: 2 }),
      });
      expect(again.status).toBe(400);
    } finally {
      await handle.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("exports completed chapters and imports a local manuscript", async () => {
    const directory = await mkdtemp(join(tmpdir(), "synchronicle-web-io-"));
    const output = join(directory, "novel");
    for (const dir of ["meta", "chapters"]) await mkdir(join(output, dir), { recursive: true });
    await writeFile(join(output, "meta", "progress.json"), JSON.stringify({ novel_name: "导出书", phase: "writing", current_chapter: 2, total_chapters: 2, completed_chapters: [1], total_word_count: 4, chapter_word_counts: { "1": 4 }, in_progress_chapter: 0, flow: "writing", pending_rewrites: [] }));
    await writeFile(join(output, "chapters", "01.md"), "第一章正文");
    const configPath = join(directory, "config.json");
    await writeFile(configPath, JSON.stringify({ provider: "deepseek", model: "deepseek-chat", providers: { deepseek: { base_url: "https://api.deepseek.com/v1" } }, output_dir: output }));
    const source = join(directory, "source.txt");
    await writeFile(source, "第 1 章 导入章名\n\n这是导入的正文内容。\n");
    const handle = await startWebServer({ port: 0, configPath });
    try {
      const json = async (path: string): Promise<any> => JSON.parse(await (await fetch(`http://127.0.0.1:${handle.port}${path}`)).text());
      const exported = await json("/api/status").then(async () => JSON.parse(await (await fetch(`http://127.0.0.1:${handle.port}/api/export`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format: "txt" }) })).text()));
      expect(exported.chapters).toBe(1);
      expect(await readFile(exported.path, "utf8")).toContain("第一章正文");

      const imported = JSON.parse(await (await fetch(`http://127.0.0.1:${handle.port}/api/import`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: source }) })).text());
      expect(imported.chapters).toBe(1);
      expect(await readFile(join(output, "chapters", "01.md"), "utf8")).toContain("这是导入的正文内容");

      const badFormat = await fetch(`http://127.0.0.1:${handle.port}/api/export`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format: "pdf" }) });
      expect(badFormat.status).toBe(400);
    } finally {
      await handle.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("masks settings on read and merges core fields on write", async () => {
    const directory = await mkdtemp(join(tmpdir(), "synchronicle-web-settings-"));
    const configPath = join(directory, "config.json");
    await writeFile(configPath, JSON.stringify({ provider: "deepseek", model: "deepseek-chat", providers: { deepseek: { base_url: "https://api.deepseek.com/v1", api_key: "secret-key" } }, output_dir: join(directory, "novel") }));
    const handle = await startWebServer({ port: 0, configPath });
    try {
      const json = async (path: string): Promise<any> => JSON.parse(await (await fetch(`http://127.0.0.1:${handle.port}${path}`)).text());
      const initial = await json("/api/settings");
      expect(initial.configured).toBe(true);
      expect(initial.settings.provider).toBe("deepseek");
      expect(initial.settings.providers.deepseek.hasApiKey).toBe(true);
      expect(JSON.stringify(initial)).not.toContain("secret-key");

      const saved = JSON.parse(await (await fetch(`http://127.0.0.1:${handle.port}/api/settings`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "deepseek-chat", roles: { writer: { provider: "deepseek", model: "deepseek-chat" } } }),
      })).text());
      expect(saved.saved).toBe(true);
      expect(saved.settings.model).toBe("deepseek-chat");
      expect(saved.settings.roles.writer.model).toBe("deepseek-chat");

      const persisted = JSON.parse(await readFile(configPath, "utf8"));
      expect(persisted.model).toBe("deepseek-chat");
      expect(persisted.provider).toBe("deepseek");
      expect(persisted.providers.deepseek.api_key).toBe("secret-key");
    } finally {
      await handle.close();
      await rm(directory, { recursive: true, force: true });
    }
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

  it("serves diag report with pacing findings from a seeded store", async () => {
    const directory = await mkdtemp(join(tmpdir(), "synchronicle-web-diag-"));
    const output = join(directory, "novel");
    await mkdir(join(output, "meta"), { recursive: true });
    await writeFile(join(output, "meta", "progress.json"), JSON.stringify({ novel_name: "测试", phase: "writing", current_chapter: 8, total_chapters: 12, completed_chapters: [1, 2, 3, 4, 5, 6, 7], total_word_count: 100, strand_history: ["感情", "支线", "主线", "主线", "主线", "主线", "主线", "主线"], flow: "writing", pending_rewrites: [] }));
    const configPath = join(directory, "config.json");
    await writeFile(configPath, JSON.stringify({ provider: "deepseek", model: "deepseek-chat", providers: { deepseek: { base_url: "https://api.deepseek.com/v1" } }, output_dir: output }));
    const handle = await startWebServer({ port: 0, configPath });
    try {
      const data = await (async () => JSON.parse(await (await fetch(`http://127.0.0.1:${handle.port}/api/diag`)).text()))();
      expect(data.configured).toBe(true);
      const pacing = data.report.findings.filter((finding: { rule: string }) => finding.rule.startsWith("PacingStall"));
      expect(pacing.length).toBeGreaterThan(0);
      expect(pacing[0].evidence).toContain("连续");
    } finally {
      await handle.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("handles steer redirection via POST /api/steer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "synchronicle-web-steer-"));
    const output = join(directory, "novel");
    await mkdir(join(output, "meta"), { recursive: true });
    await writeFile(join(output, "meta", "progress.json"), JSON.stringify({ novel_name: "引导测试", phase: "writing", current_chapter: 4, total_chapters: 10, completed_chapters: [1, 2, 3], in_progress_chapter: 4, total_word_count: 50, flow: "writing", pending_rewrites: [] }));
    const configPath = join(directory, "config.json");
    await writeFile(configPath, JSON.stringify({ provider: "deepseek", model: "deepseek-chat", providers: { deepseek: { base_url: "https://api.deepseek.com/v1" } }, output_dir: output }));
    let steerPayload: { prompt: string; targetChapter?: number } | undefined;
    const handle = await startWebServer({
      port: 0,
      configPath,
      hostInstance: {
        steer: async (options: { prompt: string; targetChapter?: number }) => {
          steerPayload = options;
          await writeFile(join(output, "meta", "injections.jsonl"), `{"text":"[Steer 引导指令: 第 ${options.targetChapter ?? 4} 章] ${options.prompt}"}\n`);
          return { aborted: false, targetChapter: options.targetChapter ?? 4 };
        },
        resume: async () => ({ label: "恢复" }),
      } as any,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/api/steer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "加快推进，出现反转", chapter: 4 }),
      });
      expect(res.status).toBe(200);
      const data = JSON.parse(await res.text());
      expect(data.success).toBe(true);
      expect(data.targetChapter).toBe(4);
      expect(steerPayload).toEqual({ prompt: "加快推进，出现反转", targetChapter: 4 });

      const injections = await readFile(join(output, "meta", "injections.jsonl"), "utf8");
      expect(injections).toContain("[Steer 引导指令: 第 4 章] 加快推进，出现反转");
    } finally {
      await handle.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("handles chapter rewrite and adoption endpoints", async () => {
    const directory = await mkdtemp(join(tmpdir(), "synchronicle-web-rewrite-"));
    const output = join(directory, "novel");
    for (const dir of ["meta", "chapters"]) await mkdir(join(output, dir), { recursive: true });
    await writeFile(join(output, "meta", "progress.json"), JSON.stringify({ novel_name: "重写书", phase: "writing", current_chapter: 2, total_chapters: 5, completed_chapters: [1], total_word_count: 20, chapter_word_counts: { "1": 20 }, in_progress_chapter: 0, flow: "writing", pending_rewrites: [] }));
    await writeFile(join(output, "chapters", "01.md"), "他不禁皱起了眉，仿佛暴风雨降临一般，心中有一丝绝望。");
    const configPath = join(directory, "config.json");
    await writeFile(configPath, JSON.stringify({ provider: "deepseek", model: "deepseek-chat", providers: { deepseek: { base_url: "https://api.deepseek.com/v1", api_key: "secret-key" } }, output_dir: output }));
    const handle = await startWebServer({ port: 0, configPath });
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/api/chapters/1/rewrite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ style: "suspense", instructions: "强化压迫感", reduceAitone: true }),
      });
      expect(res.status).toBe(200);
      const data = JSON.parse(await res.text());
      expect(data.chapter).toBe(1);
      expect(data.style).toBe("suspense");
      expect(data.staged).toBe(true);
      expect(data.newScore).toBeGreaterThanOrEqual(data.previousScore);
      expect(data.rewrittenText).not.toContain("不禁");

      const adoptRes = await fetch(`http://127.0.0.1:${handle.port}/api/chapters/1/adopt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: data.rewrittenText }),
      });
      expect(adoptRes.status).toBe(200);
      const adopted = JSON.parse(await adoptRes.text());
      expect(adopted.adopted).toBe(true);

      const updatedText = await readFile(join(output, "chapters", "01.md"), "utf8");
      expect(updatedText).toBe(data.rewrittenText);
    } finally {
      await handle.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("serves entities API for graph storage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "synchronicle-web-entities-"));
    const output = join(directory, "novel");
    for (const dir of ["meta", "chapters"]) await mkdir(join(output, dir), { recursive: true });
    const configPath = join(directory, "config.json");
    await writeFile(configPath, JSON.stringify({ provider: "deepseek", model: "deepseek-chat", providers: { deepseek: { base_url: "https://api.deepseek.com/v1", api_key: "secret-key" } }, output_dir: output }));
    const handle = await startWebServer({ port: 0, configPath });
    try {
      const getInitial = await fetch(`http://127.0.0.1:${handle.port}/api/entities`);
      expect(getInitial.status).toBe(200);
      const initData = JSON.parse(await getInitial.text());
      expect(initData.entities).toEqual([]);

      const postRes = await fetch(`http://127.0.0.1:${handle.port}/api/entities`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "hero",
          name: "林辰",
          type: "character",
          aliases: ["剑绝"],
          description: "主角",
        }),
      });
      expect(postRes.status).toBe(200);

      const getUpdated = (await (await fetch(`http://127.0.0.1:${handle.port}/api/entities`)).json()) as { entities: Array<{ name: string; aliases: string[] }> };
      expect(getUpdated.entities).toHaveLength(1);
      expect(getUpdated.entities[0]!.name).toBe("林辰");
      expect(getUpdated.entities[0]!.aliases).toContain("剑绝");
    } finally {
      await handle.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("serves p4 competitive parity endpoints", async () => {
    const directory = await mkdtemp(join(tmpdir(), "synchronicle-web-p4-"));
    const output = join(directory, "novel");
    for (const dir of ["meta", "chapters", "summaries"]) await mkdir(join(output, dir), { recursive: true });
    await writeFile(join(output, "chapters", "01.md"), "沈砚推开书局的门。“这么晚还来？”他忽然想起十年前的雨夜。");
    await writeFile(join(output, "summaries", "01.json"), JSON.stringify({ chapter: 1, summary: "沈砚发现旧钟楼的钥匙", characters: ["沈砚"], key_events: ["发现钥匙"] }));
    await writeFile(join(output, "meta", "progress.json"), JSON.stringify({ novel_name: "测试", phase: "writing", current_chapter: 2, total_chapters: 12, completed_chapters: [1], total_word_count: 30, chapter_word_counts: { "1": 30 } }));
    const configPath = join(directory, "config.json");
    await writeFile(configPath, JSON.stringify({ provider: "deepseek", model: "deepseek-chat", providers: { deepseek: { base_url: "https://api.deepseek.com/v1", api_key: "secret-key" } }, output_dir: output }));
    const handle = await startWebServer({ port: 0, configPath });
    try {
      const root = `http://127.0.0.1:${handle.port}`;

      const entityRes = await fetch(`${root}/api/entities`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "shen", name: "沈砚", type: "character", aliases: [], description: "书局掌柜" }) });
      expect(entityRes.status).toBe(200);

      const recallRes = (await (await fetch(`${root}/api/recall?q=` + encodeURIComponent("沈砚 掌柜"))).json()) as { configured: boolean; engine: string; hits: Array<{ kind: string; source: string }> };
      expect(recallRes.configured).toBe(true);
      expect(recallRes.engine).toBe("bm25");
      expect(recallRes.hits.length).toBeGreaterThan(0);
      expect(["entity", "summary"]).toContain(recallRes.hits[0]!.kind);

      const reviewRes = (await (await fetch(`${root}/api/reader-review`)).json()) as { configured: boolean; report: { chapters: unknown[]; averageScore: number } };
      expect(reviewRes.configured).toBe(true);
      expect(reviewRes.report.chapters).toHaveLength(1);

      const deconstructRes = (await (await fetch(`${root}/api/deconstruct`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "第 1 章 开端\n他推开门，血光冲天，杀意涌来。然而钟声在这时响起。\n第 2 章 转折\n他赢了。突然，一道黑影扑下。" }) }).then((item) => item.json()))) as { totalChapters: number; acts: unknown[] };
      expect(deconstructRes.totalChapters).toBe(2);
      expect(deconstructRes.acts).toHaveLength(3);

      const costRes = (await (await fetch(`${root}/api/cost-preview?chapters=12&words=3000&model=deepseek-chat`)).json()) as { totalChars: number; usd: { low: number; high: number } };
      expect(costRes.totalChars).toBe(36000);
      expect(costRes.usd.high).toBeGreaterThanOrEqual(costRes.usd.low);

      const safetyRes = (await (await fetch(`${root}/api/safety/scan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chapter: 1 }) }).then((item) => item.json()))) as { clean: boolean; scannedChars: number };
      expect(safetyRes.clean).toBe(true);
      expect(safetyRes.scannedChars).toBeGreaterThan(10);

      const badSafetyRes = (await (await fetch(`${root}/api/safety/scan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "他写下了自杀方法。" }) }).then((item) => item.json()))) as { clean: boolean; hits: Array<{ category: string }> };
      expect(badSafetyRes.clean).toBe(false);
      expect(badSafetyRes.hits[0]!.category).toBe("selfHarm");
    } finally {
      await handle.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("imports a sillytavern character card into the entity graph", async () => {
    const directory = await mkdtemp(join(tmpdir(), "synchronicle-web-card-"));
    const output = join(directory, "novel");
    for (const dir of ["meta", "chapters"]) await mkdir(join(output, dir), { recursive: true });
    const configPath = join(directory, "config.json");
    await writeFile(configPath, JSON.stringify({ provider: "deepseek", model: "deepseek-chat", providers: { deepseek: { base_url: "https://api.deepseek.com/v1", api_key: "secret-key" } }, output_dir: output }));
    const handle = await startWebServer({ port: 0, configPath });
    try {
      const png = makeTestCardPng();
      const res = await fetch(`http://127.0.0.1:${handle.port}/api/entities/import-card`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pngBase64: png.toString("base64") }) });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { saved: boolean; name: string };
      expect(data.saved).toBe(true);
      expect(data.name).toBe("沈砚");

      const bad = await fetch(`http://127.0.0.1:${handle.port}/api/entities/import-card`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pngBase64: Buffer.from("not-a-png").toString("base64") }) });
      expect(bad.status).toBe(400);
      const list = (await (await fetch(`http://127.0.0.1:${handle.port}/api/entities`)).json()) as { entities: Array<{ name: string }> };
      expect(list.entities).toHaveLength(1);
    } finally {
      await handle.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("serves p5 creation workbench endpoints", async () => {
    const directory = await mkdtemp(join(tmpdir(), "synchronicle-web-p5-"));
    const output = join(directory, "novel");
    for (const dir of ["meta", "chapters"]) await mkdir(join(output, dir), { recursive: true });
    await writeFile(join(output, "chapters", "01.md"), "沈砚推开书局的门。“这么晚还来？”他忽然想起十年前的雨夜，灯光昏黄。");
    await writeFile(join(output, "premise.md"), "少年沈砚为查父亲失踪真相，凭一本旧账本掀开全城阴谋，逆袭翻盘，杀回旧钟楼。");
    await writeFile(join(output, "meta", "progress.json"), JSON.stringify({ novel_name: "测试", phase: "writing", current_chapter: 2, total_chapters: 10, completed_chapters: [1], total_word_count: 30, chapter_word_counts: { "1": 30 } }));
    const configPath = join(directory, "config.json");
    await writeFile(configPath, JSON.stringify({ provider: "deepseek", model: "deepseek-chat", providers: { deepseek: { base_url: "https://api.deepseek.com/v1", api_key: "secret-key" } }, output_dir: output }));
    const handle = await startWebServer({ port: 0, configPath });
    try {
      const root = `http://127.0.0.1:${handle.port}`;

      await fetch(`${root}/api/entities`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "shen", name: "沈砚", type: "character", aliases: ["阿砚"], description: "书局掌柜，记忆力异于常人" }) });

      const materialRes = (await (await fetch(`${root}/api/materials`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "line", title: "雨夜对白", content: "“这么晚还来？”" }) }).then((item) => item.json()))) as { saved: boolean; material: { id: string; title: string } };
      expect(materialRes.saved).toBe(true);
      const materialList = (await (await fetch(`${root}/api/materials`)).json()) as { materials: Array<{ title: string }> };
      expect(materialList.materials).toHaveLength(1);
      const recallAfterMaterial = (await (await fetch(`${root}/api/recall?q=` + encodeURIComponent("雨夜对白"))).json()) as { hits: Array<{ kind: string }> };
      expect(recallAfterMaterial.hits[0]!.kind).toBe("material");
      const deleteRes = await fetch(`${root}/api/materials/${materialRes.material.id}`, { method: "DELETE" });
      expect(deleteRes.status).toBe(200);
      const missingRes = await fetch(`${root}/api/materials/${materialRes.material.id}`, { method: "DELETE" });
      expect(missingRes.status).toBe(404);

      const brainstormRes = (await (await fetch(`${root}/api/brainstorm?type=sect&count=5&seed=99`)).json()) as { type: string; items: string[] };
      expect(brainstormRes.items).toHaveLength(5);
      const brainstormRepeat = (await (await fetch(`${root}/api/brainstorm?type=sect&count=5&seed=99`)).json()) as { items: string[] };
      expect(brainstormRepeat.items).toEqual(brainstormRes.items);
      const badBrainstorm = await fetch(`${root}/api/brainstorm?type=unknown`);
      expect(badBrainstorm.status).toBe(400);

      const chatRes = (await (await fetch(`${root}/api/character-chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entityId: "shen", message: "钥匙在哪里？" }) }).then((item) => item.json()))) as { reply: string; prompt: string };
      expect(chatRes.reply).toContain("沈砚");
      expect(chatRes.prompt).toContain("角色扮演");
      const missingChat = await fetch(`${root}/api/character-chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entityId: "nobody", message: "在吗" }) });
      expect(missingChat.status).toBe(404);

      const goldenRes = (await (await fetch(`${root}/api/golden-review`)).json()) as { configured: boolean; report: { reviewed: number; averageScore: number } };
      expect(goldenRes.configured).toBe(true);
      expect(goldenRes.report.reviewed).toBe(1);

      const editorRes = (await (await fetch(`${root}/api/editor-review`)).json()) as { configured: boolean; report: { verdict: string; risks: Array<{ check: string }> } };
      expect(editorRes.configured).toBe(true);
      expect(["可投稿", "修改后投稿", "建议大改"]).toContain(editorRes.report.verdict);
    } finally {
      await handle.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("serves p6 consistency and platform endpoints", async () => {
    const directory = await mkdtemp(join(tmpdir(), "synchronicle-web-p6-"));
    const output = join(directory, "novel");
    for (const dir of ["meta", "chapters"]) await mkdir(join(output, dir), { recursive: true });
    await writeFile(join(output, "chapters", "01.md"), "沈砚推开书局的门。“这么晚还来？”他忽然想起十年前的雨夜。突然，钟声响了。");
    await writeFile(join(output, "meta", "progress.json"), JSON.stringify({ novel_name: "测试", phase: "writing", current_chapter: 2, total_chapters: 10, completed_chapters: [1], total_word_count: 30, chapter_word_counts: { "1": 30 } }));
    const configPath = join(directory, "config.json");
    await writeFile(configPath, JSON.stringify({ provider: "deepseek", model: "deepseek-chat", providers: { deepseek: { base_url: "https://api.deepseek.com/v1", api_key: "secret-key" } }, output_dir: output }));
    const handle = await startWebServer({ port: 0, configPath });
    try {
      const root = `http://127.0.0.1:${handle.port}`;

      const postConst = (await (await fetch(`${root}/api/constitution`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ worldRules: ["灵力使用必须付出寿命代价"], forbiddenInfo: ["主角身世第三卷前不得揭晓"], secretReveals: [{ secret: "父亲失踪真相", revealAt: "第 42 章" }] }) }).then((item) => item.json()))) as { saved: boolean; constitution: { worldRules: string[] } };
      expect(postConst.saved).toBe(true);
      expect(postConst.constitution.worldRules).toHaveLength(1);
      const getConst = (await (await fetch(`${root}/api/constitution`)).json()) as { constitution: { forbiddenInfo: string[] } };
      expect(getConst.constitution.forbiddenInfo).toHaveLength(1);

      const recallConst = (await (await fetch(`${root}/api/recall?q=` + encodeURIComponent("寿命代价"))).json()) as { hits: Array<{ kind: string }> };
      expect(recallConst.hits[0]!.kind).toBe("constitution");

      const foreshadowRes = (await (await fetch(`${root}/api/foreshadows`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "key", title: "旧钟楼钥匙", type: "chekhov", plantedChapter: 1, missedRecoveries: 3 }) }).then((item) => item.json()))) as { saved: boolean; missedRecoveries: number };
      expect(foreshadowRes.saved).toBe(true);
      expect(foreshadowRes.missedRecoveries).toBe(3);
      const foreshadowList = (await (await fetch(`${root}/api/foreshadows`)).json()) as { items: Array<{ type: string }> };
      expect(foreshadowList.items[0]!.type).toBe("chekhov");
      const diagRes = (await (await fetch(`${root}/api/diag`)).json()) as { report: { findings: Array<{ rule: string }> } };
      expect(diagRes.report.findings.some((finding) => finding.rule === "ForeshadowEscalation.critical")).toBe(true);

      const platformRes = (await (await fetch(`${root}/api/platform-review?platform=qidian`)).json()) as { configured: boolean; report: { platform: string; dimensions: Record<string, number>; overall: number } };
      expect(platformRes.configured).toBe(true);
      expect(platformRes.report.platform).toBe("qidian");
      expect(platformRes.report.dimensions.openingHook).toBeGreaterThanOrEqual(0);

      const fingerprintRes = (await (await fetch(`${root}/api/ai-fingerprint?chapter=1`)).json()) as { configured: boolean; fingerprint: { riskScore: number }; amplitude: unknown; advice: string };
      expect(fingerprintRes.configured).toBe(true);
      expect(fingerprintRes.fingerprint.riskScore).toBeGreaterThanOrEqual(0);
      expect(fingerprintRes.advice).toContain("改写幅度");
    } finally {
      await handle.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("serves arena and branch management endpoints", async () => {
    const directory = await mkdtemp(join(tmpdir(), "synchronicle-web-arena-"));
    const output = join(directory, "novel");
    for (const dir of ["meta", "chapters"]) await mkdir(join(output, dir), { recursive: true });
    await writeFile(join(output, "chapters", "01.md"), "他拔出长剑，剑尖指向地面。");
    const configPath = join(directory, "config.json");
    await writeFile(configPath, JSON.stringify({ provider: "deepseek", model: "deepseek-chat", providers: { deepseek: { base_url: "https://api.deepseek.com/v1", api_key: "secret-key" } }, output_dir: output }));
    const handle = await startWebServer({ port: 0, configPath });
    try {
      // 1. 测试 A/B 竞写接口
      const arenaRes = await fetch(`http://127.0.0.1:${handle.port}/api/chapters/1/arena`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modelA: "Claude-3.7", modelB: "DeepSeek-V3" }),
      });
      expect(arenaRes.status).toBe(200);
      const arenaData = (await arenaRes.json()) as { candidateA: unknown; candidateB: unknown; overallWinner: string };
      expect(arenaData.candidateA).toBeDefined();
      expect(arenaData.candidateB).toBeDefined();
      expect(["A", "B", "tie"]).toContain(arenaData.overallWinner);

      // 2. 测试分支创建
      const branchRes = await fetch(`http://127.0.0.1:${handle.port}/api/chapters/1/branches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "alt-ending", name: "平行抉择线", notes: "尝试反转", content: "分支正文：他最终放下了剑。" }),
      });
      expect(branchRes.status).toBe(201);

      // 3. 测试分支列表查询
      const listRes = (await (await fetch(`http://127.0.0.1:${handle.port}/api/chapters/1/branches`)).json()) as { branches: Array<{ name: string }> };
      expect(listRes.branches).toHaveLength(1);
      expect(listRes.branches[0]!.name).toBe("平行抉择线");

      // 4. 测试分支切换与合并至主干
      const checkoutRes = await fetch(`http://127.0.0.1:${handle.port}/api/chapters/1/branches/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ branchId: "alt-ending" }),
      });
      expect(checkoutRes.status).toBe(200);
      const mainContent = await readFile(join(output, "chapters", "01.md"), "utf8");
      expect(mainContent).toBe("分支正文：他最终放下了剑。");
    } finally {
      await handle.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("renders the p7 shell with studio rail, bookshelf and skill pack market", () => {
    const html = renderWebApp();
    expect(html).toContain('data-page="studio"');
    expect(html).toContain("三栏写作台");
    expect(html).toContain(".studio-rail");
    expect(html).toContain("studio-editor");
    expect(html).toContain('data-view="studio" title=');
    expect(html).toContain("书架（多书管理）");
    expect(html).toContain("技能包市场");
    expect(html).toContain("版本时光机");
    expect(html).not.toContain("innerHTML =");
  });

  it("serves p7 bookshelf, skill packs, versions and studio endpoints", async () => {
    const directory = await mkdtemp(join(tmpdir(), "synchronicle-web-p7-"));
    const output = join(directory, "novel");
    for (const dir of ["meta", "chapters"]) await mkdir(join(output, dir), { recursive: true });
    await writeFile(join(output, "chapters", "01.md"), "沈砚推开书局的门。雨夜里灯火摇晃。");
    await writeFile(join(output, "meta", "progress.json"), JSON.stringify({ novel_name: "主书", phase: "writing", current_chapter: 2, total_chapters: 10, completed_chapters: [1], total_word_count: 16, chapter_word_counts: { "1": 16 } }));
    const configPath = join(directory, "config.json");
    await writeFile(configPath, JSON.stringify({ provider: "deepseek", model: "deepseek-chat", providers: { deepseek: { base_url: "https://api.deepseek.com/v1", api_key: "secret-key" } }, output_dir: output }));
    const handle = await startWebServer({ port: 0, configPath });
    try {
      const root = `http://127.0.0.1:${handle.port}`;
      const json = async (path: string, init?: RequestInit): Promise<any> => JSON.parse(await (await fetch(`${root}${path}`, init)).text());

      // 1. 书架：初始迁移当前 output 为激活书籍，新建并切换
      const initialBooks = await json("/api/books");
      expect(initialBooks.configured).toBe(true);
      expect(initialBooks.books).toHaveLength(1);
      expect(initialBooks.books[0].title).toBe("主书");
      expect(initialBooks.books[0].active).toBe(true);

      const created = await json("/api/books", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "新书《星海》" }) });
      expect(created.created).toBe(true);
      expect(created.book.title).toBe("新书《星海》");

      const switched = await json("/api/books/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: created.book.id }) });
      expect(switched.switched).toBe(true);
      const activeBook = await json("/api/book");
      expect(activeBook.book.novelName).toBe("");

      const switchBack = await json("/api/books/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: initialBooks.activeId }) });
      expect(switchBack.switched).toBe(true);
      const restoredBook = await json("/api/book");
      expect(restoredBook.book.novelName).toBe("主书");
      const unknownSwitch = await fetch(`${root}/api/books/switch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "ghost" }) });
      expect(unknownSwitch.status).toBe(404);

      // 2. 写作台保存 + 版本时光机
      await json("/api/chapters/1/text", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "沈砚推开书局的门。雨夜里灯火摇晃。" }) });
      const saved = await json("/api/chapters/1/text", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "沈砚推开书局的门。雨夜里灯火摇晃。他抬头看向旧钟楼。" }) });
      expect(saved.saved).toBe(true);
      const chapterAfter = await json("/api/chapters/1");
      expect(chapterAfter.chapter.text).toContain("旧钟楼");

      const versions = await json("/api/chapters/1/versions");
      expect(versions.versions.length).toBe(2);
      expect(versions.versions[0].source).toBe("studio");
      const firstVersion = versions.versions.at(-1);
      const restored = await json("/api/chapters/1/versions/restore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: firstVersion.id }) });
      expect(restored.restored).toBe(true);
      const chapterRestored = await json("/api/chapters/1");
      expect(chapterRestored.chapter.text).not.toContain("旧钟楼");
      const versionsAfterRestore = await json("/api/chapters/1/versions");
      expect(versionsAfterRestore.versions[0].source).toBe("restore");

      // 3. 技能包市场：内置列表 / 启用 / 自定义包增删
      const packs = await json("/api/skillpacks");
      expect(packs.builtin).toHaveLength(8);
      expect(packs.enabledCount).toBe(0);
      const toggled = await json("/api/skillpacks/toggle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "golden-opening", enabled: true }) });
      expect(toggled.enabled).toBe(true);
      const recallWithPack = await json("/api/recall?q=" + encodeURIComponent("开篇 冲突"));
      expect(recallWithPack.hits.some((hit: { kind: string }) => hit.kind === "skillpack")).toBe(true);

      const packCreated = await json("/api/skillpacks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "短句张力包", techniques: "高潮句压到十字内\n多用动词开头" }) });
      expect(packCreated.created).toBe(true);
      const packsAfterCreate = await json("/api/skillpacks");
      expect(packsAfterCreate.custom).toHaveLength(1);
      const packDeleted = await json(`/api/skillpacks/${packCreated.pack.id}`, { method: "DELETE" });
      expect(packDeleted.removed).toBe(true);
      const builtinDelete = await fetch(`${root}/api/skillpacks/golden-opening`, { method: "DELETE" });
      expect(builtinDelete.status).toBe(404);
    } finally {
      await handle.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
