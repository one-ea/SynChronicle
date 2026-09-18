import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readdir } from "node:fs/promises";
import { loadAssets } from "../assets/load.js";
import { defaultConfigPath, fillDefaults, loadConfig, needsSetup, saveConfig } from "../config/index.js";
import { validateConfig } from "../config/validate.js";
import { Host } from "../runtime/host.js";
import { renderWebApp } from "./app.js";
import { renderReadApp } from "./read.js";
import { Store } from "../store/index.js";
import { FileIO } from "../store/io.js";
import { detectAitone } from "../stylestat/aitone.js";
import { diagnose } from "../diag/index.js";
import type { ResolvedConfig } from "../config/schemas.js";

export interface WebServerOptions { port?: number; host?: string; configPath?: string; hostInstance?: Host; }
export interface WebServerHandle { port: number; close(): Promise<void>; }
interface RuntimeContext { host?: Host; store?: Store; config?: ResolvedConfig; configured: boolean; configPath: string; error?: string; }

export async function startWebServer(options: WebServerOptions = {}): Promise<WebServerHandle> {
  const context = await loadRuntime(options.configPath);
  if (options.hostInstance) context.host = options.hostInstance;
  const server = createServer((request, response) => void route(request, response, context));
  const port = await listen(server, options.port ?? 3000, options.host ?? "127.0.0.1");
  return { port, close: () => close(server, context.host) };
}

async function loadRuntime(configPath?: string): Promise<RuntimeContext> {
  const targetPath = configPath || defaultConfigPath();
  try {
    if (await needsSetup(configPath)) return { configured: false, configPath: targetPath };
    const config = await loadConfig(configPath);
    return { config, configured: true, configPath: targetPath, store: new Store(config.output_dir ?? "output/novel") };
  } catch (error) {
    return { configured: false, configPath: targetPath, error: error instanceof Error ? error.message : String(error) };
  }
}

async function route(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  response.setHeader("access-control-allow-origin", "*");
  const url = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "GET" && url.pathname === "/") return send(response, 200, renderWebApp(), "text/html; charset=utf-8");
  if (request.method === "GET" && url.pathname === "/read") return send(response, 200, renderReadApp(), "text/html; charset=utf-8");
  if (request.method === "GET" && url.pathname === "/api/health") return sendJson(response, 200, { ok: true });
  if (request.method === "GET" && url.pathname === "/api/status") return sendJson(response, 200, await status(context));
  if (request.method === "GET" && url.pathname === "/api/events") return sendJson(response, 200, context.host ? { events: await context.host.replayQueue() } : { events: [] });
  if (request.method === "POST" && url.pathname === "/api/config") return handleConfig(request, response, context);
  if (request.method === "POST" && url.pathname === "/api/run") return handleRun(request, response, context);
  if (request.method === "POST" && url.pathname === "/api/continue") return handleContinue(request, response, context);
  if (request.method === "POST" && url.pathname === "/api/resume") return handleResume(response, context);
  if (request.method === "POST" && url.pathname === "/api/steer") return handleSteer(request, response, context);
  if (request.method === "POST" && url.pathname === "/api/inject") return handleInject(request, response, context);
  if (request.method === "GET" && url.pathname === "/api/book") return handleBook(response, context);
  if (request.method === "GET" && url.pathname === "/api/diag") return handleDiag(response, context);
  if (request.method === "GET" && url.pathname === "/api/reflection") return handleReflectionList(response, context);
  if (request.method === "POST" && url.pathname === "/api/reflection/commit") return handleReflectionCommit(request, response, context);
  if (request.method === "POST" && url.pathname === "/api/export") return handleExport(request, response, context);
  if (request.method === "POST" && url.pathname === "/api/import") return handleImport(request, response, context);
  if (request.method === "GET" && url.pathname === "/api/settings") return handleSettingsGet(response, context);
  if (request.method === "POST" && url.pathname === "/api/settings") return handleSettingsPost(request, response, context);
  if (request.method === "GET" && /^\/api\/chapters\/\d+$/.test(url.pathname)) return handleChapter(response, context, Number(url.pathname.split("/").pop()));
  if (request.method === "GET" && url.pathname === "/api/stream") return handleStream(request, response, context);
  sendJson(response, 404, { error: "Not found" });
}

type ChapterStatus = "completed" | "in-progress" | "pending" | "rewrite";

async function handleDiag(response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 200, { configured: false, report: null });
  try {
    sendJson(response, 200, { configured: true, report: await diagnose(context.store) });
  } catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
}

interface ReflectionArtifactView { id: string; round: number; target: string; status: string; preview: string }

async function handleReflectionList(response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 200, { configured: false, sessions: [] });
  try {
    const root = new FileIO(context.store.dir);
    const entries = await readdir(root.path("meta/reflection"), { withFileTypes: true }).catch(() => []);
    const sessions = [];
    for (const entry of entries.filter((item) => item.isDirectory()).map((item) => item.name).sort().reverse()) {
      const manifest = await root.readJSON<{ sessionId: string; artifacts: Array<{ id: string; round: number; target: string; contentFile: string; status: string }> }>(`meta/reflection/${entry}/manifest.json`);
      if (!manifest?.artifacts?.length) continue;
      const artifacts: ReflectionArtifactView[] = [];
      for (const artifact of manifest.artifacts) {
        const content = await root.readText(artifact.contentFile);
        artifacts.push({ id: artifact.id, round: artifact.round, target: artifact.target, status: artifact.status, preview: [...content].slice(0, 160).join("") });
      }
      const rounds = [...new Set(artifacts.map((artifact) => artifact.round))].sort((a, b) => b - a).map((round) => ({ round, artifacts: artifacts.filter((artifact) => artifact.round === round) }));
      sessions.push({ sessionId: entry, rounds });
    }
    sendJson(response, 200, { configured: true, sessions });
  } catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleReflectionCommit(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 503, { error: "尚未配置模型" });
  try {
    const body = await readJson(request);
    const sessionId = optionalText(body.sessionId);
    const round = Number(body.round);
    if (!sessionId || !/^[A-Za-z0-9_-]+$/.test(sessionId) || !Number.isSafeInteger(round) || round <= 0) return sendJson(response, 400, { error: "sessionId 与正整数 round 必填" });
    const manifest = await new FileIO(context.store.dir).readJSON<{ artifacts: Array<{ id: string; round: number; status: string }> }>(`meta/reflection/${sessionId}/manifest.json`);
    const ids = (manifest?.artifacts ?? []).filter((artifact) => artifact.round === round && artifact.status === "staged").map((artifact) => artifact.id);
    if (!ids.length) return sendJson(response, 400, { error: "该轮没有可采纳的候选（会话或轮次不存在，或已全部提交）" });
    const session = await context.store.staging.createSession(sessionId);
    await session.commit(ids);
    sendJson(response, 200, { committed: ids.length });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleExport(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.configured) return sendJson(response, 503, { error: context.error || "尚未配置模型，请先准备配置文件" });
  try {
    const body = await readJson(request);
    const format = optionalText(body.format) || "txt";
    if (format !== "txt" && format !== "epub") return sendJson(response, 400, { error: "format 仅支持 txt 或 epub" });
    const from = Number.isSafeInteger(body.from) && (body.from as number) > 0 ? body.from as number : undefined;
    const to = Number.isSafeInteger(body.to) && (body.to as number) > 0 ? body.to as number : undefined;
    const host = await ensureHost(context);
    const result = await host.export({ format, ...(from ? { from } : {}), ...(to ? { to } : {}) });
    sendJson(response, 200, result);
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleImport(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.configured) return sendJson(response, 503, { error: context.error || "尚未配置模型，请先准备配置文件" });
  try {
    const body = await readJson(request);
    const path = optionalText(body.path);
    if (!path) return sendJson(response, 400, { error: "path 不能为空（服务器本机上的文本文件路径）" });
    const host = await ensureHost(context);
    const result = await host.importText(path);
    context.store = host.store;
    sendJson(response, 200, result);
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

function maskSettings(config: NonNullable<RuntimeContext["config"]>): Record<string, unknown> {
  const providers: Record<string, { hasApiKey: boolean; baseUrl?: string }> = {};
  for (const [name, provider] of Object.entries(config.providers ?? {})) providers[name] = { hasApiKey: Boolean(provider.api_key), ...(provider.base_url ? { baseUrl: provider.base_url } : {}) };
  return { provider: config.provider, model: config.model, style: config.style ?? "default", outputDir: config.output_dir ?? "output/novel", providers, roles: config.roles ?? {}, ...(config.budget ? { budget: config.budget } : {}), ...(config.notify ? { notify: config.notify } : {}), ...(config.reflection ? { reflection: config.reflection } : {}) };
}

async function handleSettingsGet(response: ServerResponse, context: RuntimeContext): Promise<void> {
  try {
    const config = context.config ?? await loadConfig(context.configPath || undefined);
    sendJson(response, 200, { configured: true, settings: maskSettings(config) });
  } catch (error) { sendJson(response, 200, { configured: false, error: error instanceof Error ? error.message : String(error) }); }
}

async function handleSettingsPost(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  try {
    const body = await readJson(request);
    const current = await loadConfig(context.configPath || undefined);
    const provider = optionalText(body.provider) || current.provider;
    const model = optionalText(body.model) || current.model;
    const rolesInput = (body.roles && typeof body.roles === "object" ? body.roles : {}) as Record<string, { provider?: unknown; model?: unknown }>;
    const roles = { ...(current.roles ?? {}) };
    for (const [role, value] of Object.entries(rolesInput)) {
      const provider = typeof value?.provider === "string" ? value.provider.trim() : "";
      const model = typeof value?.model === "string" ? value.model.trim() : "";
      if (provider && model) roles[role] = { ...(roles[role] ?? {}), provider, model };
    }
    const next = fillDefaults({ ...current, provider, model, roles });
    validateConfig(next);
    await saveConfig(context.configPath || defaultConfigPath(), next);
    context.config = next;
    context.configured = true;
    sendJson(response, 200, { saved: true, settings: maskSettings(next) });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleBook(response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 200, { configured: false, book: null });
  try {
    const store = context.store;
    const [progress, layered, flat] = await Promise.all([store.progress.load(), store.outline.loadLayeredOutline(), store.outline.loadOutline()]);
    const completed = new Set(progress?.completed_chapters ?? []);
    const rewrites = new Set(progress?.pending_rewrites ?? []);
    const inProgress = progress?.in_progress_chapter ?? 0;
    const words = progress?.chapter_word_counts ?? {};
    const status = (n: number): ChapterStatus => rewrites.has(n) ? "rewrite" : completed.has(n) ? "completed" : n === inProgress ? "in-progress" : "pending";
    const entry = (n: number, title: string) => ({ chapter: n, title, status: status(n), wordCount: words[String(n)] ?? 0 });
    const volumes = layered.length
      ? layered.map((volume) => ({ index: volume.index, title: volume.title, theme: volume.theme ?? "", arcs: (volume.arcs ?? []).map((arc) => ({ index: arc.index, title: arc.title, goal: arc.goal ?? "", estimatedChapters: arc.estimated_chapters, chapters: (arc.chapters ?? []).map((item) => entry(item.chapter, item.title)) })) }))
      : flat.length
        ? [{ index: 1, title: "正文", theme: "", arcs: [{ index: 1, title: "章节", goal: "", estimatedChapters: undefined, chapters: flat.map((item) => entry(item.chapter, item.title)) }] }]
        : [];
    sendJson(response, 200, { configured: true, book: { novelName: progress?.novel_name ?? "", phase: progress?.phase ?? "init", completedChapters: progress?.completed_chapters ?? [], totalChapters: progress?.total_chapters ?? 0, totalWordCount: progress?.total_word_count ?? 0, pendingRewrites: progress?.pending_rewrites ?? [], inProgressChapter: inProgress, volumes } });
  } catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleChapter(response: ServerResponse, context: RuntimeContext, chapter: number): Promise<void> {
  if (chapter <= 0) return sendJson(response, 400, { error: "chapter 必须是正整数" });
  if (!context.store) return sendJson(response, 200, { configured: false, chapter: null });
  try {
    const store = context.store;
    const pad = String(chapter).padStart(2, "0");
    const [progress, finalText, draft, summary, outline, review] = await Promise.all([
      store.progress.load(),
      store.drafts.loadChapterText(chapter),
      store.drafts.loadDraft(chapter),
      store.summaries.loadSummary(chapter),
      store.outline.loadOutline(),
      new FileIO(store.dir).readJSON(`reviews/${pad}.json`),
    ]);
    const completed = progress?.completed_chapters.includes(chapter) ?? false;
    const rewrites = progress?.pending_rewrites?.includes(chapter) ?? false;
    const inProgress = progress?.in_progress_chapter === chapter;
    const text = finalText || draft || null;
    const entry = outline.find((item) => item.chapter === chapter);
    sendJson(response, 200, {
      configured: true,
      chapter: {
        chapter, title: entry?.title ?? `第 ${chapter} 章`,
        status: rewrites ? "rewrite" : completed ? "completed" : inProgress ? "in-progress" : "pending",
        wordCount: progress?.chapter_word_counts?.[String(chapter)] ?? ([...(text ?? "")].length),
        text, source: finalText ? "final" : draft ? "draft" : null,
        summary: summary ? { summary: summary.summary, keyEvents: summary.key_events ?? [] } : null,
        outlineEntry: entry ? { coreEvent: entry.core_event, hook: entry.hook } : null,
        review: projectReview(review),
        aitone: text ? detectAitone(text) : null,
      },
    });
  } catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
}

interface ReviewDimension { dimension: string; score: number; verdict: string; comment?: string }
function projectReview(review: unknown): { verdict: string; summary: string; dimensions: ReviewDimension[] } | null {
  if (!review || typeof review !== "object" || !("verdict" in review)) return null;
  const source = review as { verdict?: unknown; summary?: unknown; dimensions?: unknown };
  const dimensions: ReviewDimension[] = Array.isArray(source.dimensions)
    ? source.dimensions.filter((item): item is ReviewDimension => Boolean(item && typeof item === "object" && "dimension" in item && "score" in item && "verdict" in item))
    : [];
  return { verdict: String(source.verdict ?? ""), summary: String(source.summary ?? ""), dimensions };
}

const sseClients = new Set<ServerResponse>();
let sseConsuming = false;
function sseChunk(event: string, data: unknown): string { return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; }
function broadcast(event: string, data: unknown): void { const chunk = sseChunk(event, data); for (const client of sseClients) client.write(chunk); }
function startSseConsumption(context: RuntimeContext): void {
  const host = context.host;
  if (sseConsuming || !host) return;
  sseConsuming = true;
  void (async () => { try { for await (const event of host.events()) broadcast("runtime", event); } catch { /* host closed */ } })();
  void (async () => { try { for await (const delta of host.stream(true)) broadcast("delta", { value: delta }); } catch { /* host closed */ } })();
}
async function handleStream(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" });
  response.write(sseChunk("snapshot", await lightStatus(context)));
  if (context.host) {
    if (!sseConsuming) {
      const backlog = await context.host.replayQueue(12);
      for (const item of backlog) response.write(sseChunk("runtime", item.payload ?? { type: "system", message: item.summary, time: item.time }));
    }
    sseClients.add(response);
    startSseConsumption(context);
  }
  const heartbeat = setInterval(() => { void lightStatus(context).then((snapshot) => { if (sseClients.has(response)) response.write(sseChunk("snapshot", snapshot)); }); }, 5000);
  request.on("close", () => { clearInterval(heartbeat); sseClients.delete(response); });
}

async function lightStatus(context: RuntimeContext): Promise<Record<string, unknown>> {
  const snapshot = context.host?.snapshot() ?? (context.config ? { runtimeState: "idle", provider: context.config.provider, model: context.config.model, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUSD: 0 } } : undefined);
  return { configured: context.configured, ...(context.error ? { error: context.error } : {}), snapshot };
}

async function status(context: RuntimeContext): Promise<Record<string, unknown>> {
  const snapshot = context.host?.snapshot() ?? (context.config ? { runtimeState: "idle", provider: context.config.provider, model: context.config.model, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUSD: 0 } } : undefined);
  return { configured: context.configured, ...(context.error ? { error: context.error } : {}), snapshot, events: context.host ? await context.host.replayQueue(12) : [] };
}

async function handleConfig(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  try {
    const body = await readJson(request);
    const provider = textField(body.provider, "provider");
    const model = textField(body.model, "model");
    const apiKey = optionalText(body.apiKey);
    const baseUrl = optionalText(body.baseUrl);
    const type = optionalText(body.type);
    const input = { provider, model, style: "default", roles: {}, providers: { [provider]: { ...(apiKey ? { api_key: apiKey } : {}), ...(baseUrl ? { base_url: baseUrl } : {}), ...(type ? { type } : {}) } } };
    validateConfig(input);
    const config = fillDefaults(input);
    await saveConfig(context.configPath, config);
    context.config = config;
    context.configured = true;
    context.error = undefined;
    sendJson(response, 201, { configured: true });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleRun(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.configured) return sendJson(response, 503, { error: context.error || "尚未配置模型，请先准备配置文件" });
  try {
    const host = await ensureHost(context);
    const body = await readJson(request);
    if (typeof body.prompt !== "string" || !body.prompt.trim()) return sendJson(response, 400, { error: "prompt 不能为空" });
    void host.startPrepared(body.prompt).catch(() => undefined);
    sendJson(response, 202, { started: true });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleInject(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.configured) return sendJson(response, 503, { error: context.error || "尚未配置模型，请先准备配置文件" });
  try {
    const host = await ensureHost(context);
    const body = await readJson(request);
    if (typeof body.text !== "string" || !body.text.trim()) return sendJson(response, 400, { error: "text 不能为空" });
    await host.inject(body.text);
    sendJson(response, 202, { accepted: true });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleContinue(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.configured) return sendJson(response, 503, { error: context.error || "尚未配置模型，请先准备配置文件" });
  try {
    const host = await ensureHost(context);
    const body = await readJson(request);
    if (typeof body.prompt !== "string" || !body.prompt.trim()) return sendJson(response, 400, { error: "prompt 不能为空" });
    void host.continue(body.prompt).catch(() => undefined);
    sendJson(response, 202, { started: true });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleResume(response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.configured) return sendJson(response, 503, { error: context.error || "尚未配置模型，请先准备配置文件" });
  try {
    const host = await ensureHost(context);
    void host.resume().catch(() => undefined);
    sendJson(response, 202, { started: true });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleSteer(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  try {
    const payload = await readJson(request);
    const prompt = textField(payload.prompt, "引导提示词");
    const targetChapter = typeof payload.chapter === "number" ? payload.chapter : undefined;
    const host = await ensureHost(context);
    const result = await host.steer({ prompt, targetChapter });
    void host.resume().catch(() => undefined);
    sendJson(response, 200, { success: true, ...result });
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function ensureHost(context: RuntimeContext): Promise<Host> {
  if (context.host) return context.host;
  if (!context.config) throw new Error("尚未配置模型，请先准备配置文件");
  try { context.host = await Host.new(context.config, loadAssets(context.config.style)); return context.host; }
  catch (error) { context.error = error instanceof Error ? error.message : String(error); throw error; }
}

function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => { let raw = ""; request.setEncoding("utf8"); request.on("data", (chunk: string) => { raw += chunk; if (raw.length > 1_000_000) reject(new Error("request body too large")); }); request.on("end", () => { try { const parsed = JSON.parse(raw || "{}"); resolve(parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}); } catch { reject(new Error("请求体不是有效 JSON")); } }); request.on("error", reject); });
}

function textField(value: unknown, name: string): string { const text = optionalText(value); if (!text) throw new Error(`${name} 不能为空`); return text; }
function optionalText(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }

function send(response: ServerResponse, statusCode: number, body: string, contentType: string): void { response.writeHead(statusCode, { "content-type": contentType, "cache-control": "no-store" }); response.end(body); }
function sendJson(response: ServerResponse, statusCode: number, body: unknown): void { send(response, statusCode, JSON.stringify(body), "application/json; charset=utf-8"); }
function listen(server: Server, port: number, host: string): Promise<number> { return new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, () => { server.off("error", reject); const address = server.address(); resolve(typeof address === "object" && address ? address.port : port); }); }); }
async function close(server: Server, host?: Host): Promise<void> { if (typeof host?.close === "function") await host.close().catch(() => undefined); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
