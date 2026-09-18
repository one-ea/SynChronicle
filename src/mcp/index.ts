/**
 * 零依赖 stdio MCP server（specs/2026-09-18-mcp-server）。
 * JSON-RPC 2.0 按行分帧；协议子集：initialize / notifications/initialized / ping / tools/list / tools/call。
 * 工具与 Web 控制台同源：直读 Store、复用 diagnose 与 detectAitone；Host 仅在 run 首次调用时构建。
 */
import { createInterface } from "node:readline";
import { defaultConfigPath, loadConfig, needsSetup } from "../config/index.js";
import { diagnose } from "../diag/index.js";
import { detectAitone } from "../stylestat/aitone.js";
import { Store } from "../store/index.js";
import { FileIO } from "../store/io.js";
import { loadAssets } from "../assets/load.js";
import { Host } from "../runtime/host.js";
import type { ResolvedConfig } from "../config/schemas.js";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "synchronicle", version: "2.0.0" };

interface HostLike { startPrepared(prompt: string): Promise<void>; continue(prompt: string): Promise<void>; snapshot(): { runtimeState: string }; }

export interface McpMessage { jsonrpc: "2.0"; id?: number | string; method?: string; params?: Record<string, unknown> }
export interface McpToolSpec { name: string; description: string; inputSchema: Record<string, unknown> }

export interface McpOptions { configPath?: string; host?: HostLike; now?: () => Date }

interface ToolContext { config?: ResolvedConfig; configured: boolean; store?: Store; error?: string }

export function createMcpHandler(options: McpOptions = {}): (message: McpMessage) => Promise<unknown | undefined> {
  const now = options.now ?? (() => new Date());
  let context: ToolContext | undefined;
  let host: HostLike | undefined;
  const loadContext = async (): Promise<ToolContext> => {
    if (context) return context;
    try {
      if (await needsSetup(options.configPath || undefined)) return (context = { configured: false });
      const config = await loadConfig(options.configPath || undefined);
      return (context = { config, configured: true, store: new Store(config.output_dir ?? "output/novel") });
    } catch (error) {
      return (context = { configured: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
  const ensureHost = async (): Promise<HostLike> => {
    if (options.host) return options.host;
    if (host) return host;
    const ctx = await loadContext();
    if (!ctx.config) throw new Error("尚未配置模型，请先通过 Web 控制台或配置文件准备配置");
    host = await Host.new(ctx.config, loadAssets(ctx.config.style));
    return host;
  };

  return async function handleMessage(message: McpMessage): Promise<unknown | undefined> {
    if (message.method === undefined) return undefined;
    const isRequest = message.id !== undefined;
    const respond = (result: unknown) => (isRequest ? { jsonrpc: "2.0" as const, id: message.id, result } : undefined);
    const fail = (code: number, text: string) => (isRequest ? { jsonrpc: "2.0" as const, id: message.id, error: { code, message: text } } : undefined);

    switch (message.method) {
      case "initialize":
        return respond({ protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
      case "notifications/initialized":
      case "initialized":
        return undefined;
      case "ping":
        return respond({});
      case "tools/list":
        return respond({ tools: TOOLS });
      case "tools/call": {
        const name = String(message.params?.name ?? "");
        const tool = TOOLS.find((item) => item.name === name);
        if (!tool) return fail(-32602, `unknown tool: ${name}`);
        try {
          return respond(await invoke(name, (message.params?.arguments ?? {}) as Record<string, unknown>, { loadContext, ensureHost, now }));
        } catch (error) {
          return respond({ content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true });
        }
      }
      default:
        return fail(-32601, `method not found: ${message.method}`);
    }
  };
}

const TOOLS: McpToolSpec[] = [
  { name: "synchronicle_status", description: "查询 SynChronicle 引擎与作品状态：配置、阶段、章节进度、字数、模型", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "synchronicle_book", description: "获取卷-弧-章三层大纲树与章节状态（completed/in-progress/pending/rewrite）", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "synchronicle_chapter", description: "读取单章详情：正文（终稿优先草稿兜底）、摘要、Editor 评审维度、AI 味得分", inputSchema: { type: "object", properties: { chapter: { type: "integer", description: "章节号（正整数）" } }, required: ["chapter"], additionalProperties: false } },
  { name: "synchronicle_diag", description: "运行只读诊断：工件完整性检查 + 节奏红线（PacingStall）等 findings", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "synchronicle_run", description: "发起或继续创作（异步启动，立即返回；运行中注入用 synchronicle_inject）", inputSchema: { type: "object", properties: { prompt: { type: "string", description: "创作 brief 或继续指令" } }, required: ["prompt"], additionalProperties: false } },
  { name: "synchronicle_inject", description: "注入运行干预意见（在下一次 run 开头以 [用户干预] 前缀送达）", inputSchema: { type: "object", properties: { text: { type: "string", description: "干预内容" } }, required: ["text"], additionalProperties: false } },
];

interface InvokeDeps { loadContext(): Promise<ToolContext>; ensureHost(): Promise<HostLike>; now(): Date }

async function invoke(name: string, args: Record<string, unknown>, deps: InvokeDeps): Promise<unknown> {
  if (name === "synchronicle_status") {
    const ctx = await deps.loadContext();
    if (!ctx.config) return text(`configured: false${ctx.error ? `\nerror: ${ctx.error}` : ""}`);
    const progress = await ctx.store!.progress.load();
    return text(JSON.stringify({ configured: true, provider: ctx.config.provider, model: ctx.config.model, phase: progress?.phase ?? "init", completedChapters: progress?.completed_chapters.length ?? 0, totalChapters: progress?.total_chapters ?? 0, totalWordCount: progress?.total_word_count ?? 0 }, null, 2));
  }
  if (name === "synchronicle_book") {
    const ctx = await deps.loadContext();
    if (!ctx.store) return text("configured: false（尚未配置模型）");
    const [progress, layered, flat] = await Promise.all([ctx.store.progress.load(), ctx.store.outline.loadLayeredOutline(), ctx.store.outline.loadOutline()]);
    const completed = new Set(progress?.completed_chapters ?? []);
    const rewrites = new Set(progress?.pending_rewrites ?? []);
    const inProgress = progress?.in_progress_chapter ?? 0;
    const words = progress?.chapter_word_counts ?? {};
    const status = (n: number) => rewrites.has(n) ? "rewrite" : completed.has(n) ? "completed" : n === inProgress ? "in-progress" : "pending";
    const chapters = (entries: Array<{ chapter: number; title: string }>) => entries.map((entry) => ({ chapter: entry.chapter, title: entry.title, status: status(entry.chapter), wordCount: words[String(entry.chapter)] ?? 0 }));
    const volumes = layered.length ? layered.map((volume) => ({ index: volume.index, title: volume.title, arcs: (volume.arcs ?? []).map((arc) => ({ index: arc.index, title: arc.title, chapters: chapters(arc.chapters ?? []) })) })) : flat.length ? [{ index: 1, title: "正文", arcs: [{ index: 1, title: "章节", chapters: chapters(flat) }] }] : [];
    return text(JSON.stringify({ novelName: progress?.novel_name ?? "", phase: progress?.phase ?? "init", volumes }, null, 2));
  }
  if (name === "synchronicle_chapter") {
    const chapter = Number(args.chapter);
    if (!Number.isSafeInteger(chapter) || chapter <= 0) throw new Error("chapter 必须是正整数");
    const ctx = await deps.loadContext();
    if (!ctx.store) return text("configured: false（尚未配置模型）");
    const store = ctx.store;
    const pad = String(chapter).padStart(2, "0");
    const [progress, finalText, draft, summary, outline, review] = await Promise.all([
      store.progress.load(), store.drafts.loadChapterText(chapter), store.drafts.loadDraft(chapter), store.summaries.loadSummary(chapter),
      store.outline.loadOutline(), new FileIO(store.dir).readJSON(`reviews/${pad}.json`),
    ]);
    const entry = outline.find((item) => item.chapter === chapter);
    const body = finalText || draft || null;
    const completed = progress?.completed_chapters.includes(chapter) ?? false;
    return text(JSON.stringify({ chapter, title: entry?.title ?? `第 ${chapter} 章`, status: progress?.pending_rewrites?.includes(chapter) ? "rewrite" : completed ? "completed" : progress?.in_progress_chapter === chapter ? "in-progress" : "pending", wordCount: progress?.chapter_word_counts?.[String(chapter)] ?? [...(body ?? "")].length, text: body, summary: summary ? { summary: summary.summary, keyEvents: summary.key_events ?? [] } : null, review, aitone: body ? detectAitone(body) : null }, null, 2));
  }
  if (name === "synchronicle_diag") {
    const ctx = await deps.loadContext();
    if (!ctx.store) return text("configured: false（尚未配置模型）");
    return text(JSON.stringify(await diagnose(ctx.store), null, 2));
  }
  if (name === "synchronicle_run") {
    const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
    if (!prompt) throw new Error("prompt 不能为空");
    const ctx = await deps.loadContext();
    if (!ctx.config) throw new Error("尚未配置模型，请先通过 Web 控制台或配置文件准备配置");
    const host = await deps.ensureHost();
    const state = host.snapshot().runtimeState;
    void (state === "running" ? Promise.reject(new Error("引擎运行中，请先用 synchronicle_inject 注入干预")) : state === "completed" || state === "paused" ? host.continue(prompt) : host.startPrepared(prompt)).catch(() => undefined);
    return text(JSON.stringify({ started: true, previousState: state, note: "异步启动；用 synchronicle_status 轮询进度" }, null, 2));
  }
  const injectText = typeof args.text === "string" ? args.text.trim() : "";
  if (!injectText) throw new Error("text 不能为空");
  const ctx = await deps.loadContext();
  if (!ctx.config) throw new Error("尚未配置模型，请先通过 Web 控制台或配置文件准备配置");
  await new FileIO(ctx.store!.dir).appendJSONLine("meta/injections.jsonl", { text: injectText, time: deps.now().toISOString() });
  return text("已注入，将在下一次 run 开头送达");
}

const text = (value: string) => ({ content: [{ type: "text", text: value }] });

export async function startMcpServer(options: McpOptions = {}): Promise<void> {
  const handler = createMcpHandler(options);
  const input = createInterface({ input: process.stdin });
  process.stdout.write("");
  return new Promise<void>((resolve) => {
    input.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      void (async () => {
        try {
          const result = await handler(JSON.parse(trimmed) as McpMessage);
          if (result !== undefined) process.stdout.write(`${JSON.stringify(result)}\n`);
        } catch (error) {
          process.stderr.write(`mcp parse error: ${error instanceof Error ? error.message : String(error)}\n`);
        }
      })();
    });
    input.on("close", () => resolve());
  });
}

export { defaultConfigPath };
