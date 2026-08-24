import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { loadAssets } from "../assets/load.js";
import { defaultConfigPath, fillDefaults, loadConfig, needsSetup, saveConfig } from "../config/index.js";
import { validateConfig } from "../config/validate.js";
import { Host } from "../runtime/host.js";
import { renderWebApp } from "./app.js";
import type { ResolvedConfig } from "../config/schemas.js";

export interface WebServerOptions { port?: number; host?: string; configPath?: string; }
export interface WebServerHandle { port: number; close(): Promise<void>; }
interface RuntimeContext { host?: Host; config?: ResolvedConfig; configured: boolean; configPath: string; error?: string; }

export async function startWebServer(options: WebServerOptions = {}): Promise<WebServerHandle> {
  const context = await loadRuntime(options.configPath);
  const server = createServer((request, response) => void route(request, response, context));
  const port = await listen(server, options.port ?? 3000, options.host ?? "127.0.0.1");
  return { port, close: () => close(server, context.host) };
}

async function loadRuntime(configPath?: string): Promise<RuntimeContext> {
  const targetPath = configPath || defaultConfigPath();
  try {
    if (await needsSetup(configPath)) return { configured: false, configPath: targetPath };
    const config = await loadConfig(configPath);
    return { config, configured: true, configPath: targetPath };
  } catch (error) {
    return { configured: false, configPath: targetPath, error: error instanceof Error ? error.message : String(error) };
  }
}

async function route(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  response.setHeader("access-control-allow-origin", "*");
  const url = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "GET" && url.pathname === "/") return send(response, 200, renderWebApp(), "text/html; charset=utf-8");
  if (request.method === "GET" && url.pathname === "/api/health") return sendJson(response, 200, { ok: true });
  if (request.method === "GET" && url.pathname === "/api/status") return sendJson(response, 200, await status(context));
  if (request.method === "GET" && url.pathname === "/api/events") return sendJson(response, 200, context.host ? { events: await context.host.replayQueue() } : { events: [] });
  if (request.method === "POST" && url.pathname === "/api/config") return handleConfig(request, response, context);
  if (request.method === "POST" && url.pathname === "/api/run") return handleRun(request, response, context);
  if (request.method === "POST" && url.pathname === "/api/continue") return handleContinue(request, response, context);
  if (request.method === "POST" && url.pathname === "/api/resume") return handleResume(response, context);
  if (request.method === "POST" && url.pathname === "/api/inject") return handleInject(request, response, context);
  sendJson(response, 404, { error: "Not found" });
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
async function close(server: Server, host?: Host): Promise<void> { await host?.close().catch(() => undefined); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
