import type { Writable } from "node:stream";
import type { Config } from "../config/index.js";
import type { Bundle, RuntimeEvent, RuntimeQueueItem } from "../domain/index.js";
import { Host } from "../runtime/host.js";
import { terminalAskUser } from "./ask_user.js";

interface HeadlessHost { store: { dir: string }; startPrepared(prompt: string): Promise<void>; resume(): Promise<{ label: string | null; error?: Error }>; replayQueue(maxItems?: number): Promise<RuntimeQueueItem[]>; events(): AsyncIterable<RuntimeEvent>; stream(): AsyncIterable<string>; close(): Promise<void> }
export interface Options { prompt?: string; stdin?: NodeJS.ReadableStream; stdout?: Writable; stderr?: Writable; hostFactory?: (cfg: Config, bundle: Bundle) => Promise<HeadlessHost> }
export async function run(cfg: Config, bundle: Bundle, opts: Options = {}): Promise<void> { const stdout = opts.stdout ?? process.stdout, stderr = opts.stderr ?? process.stderr; const factory = opts.hostFactory ?? ((config, assets) => Host.new(config, assets, { askUser: terminalAskUser() })); const host = await factory(cfg, bundle); try { const prompt = opts.prompt?.trim() ?? ""; if (prompt) { stderr.write(`headless 启动: ${host.store.dir}\n`); await host.startPrepared(prompt); } else { replay(await host.replayQueue(0), stdout, stderr); const result = await host.resume(); if (result.error) throw result.error; if (!result.label) throw new Error(`headless 模式需要 --prompt，或输出目录 ${JSON.stringify(host.store.dir)} 下已有可恢复会话`); stderr.write(`headless 恢复: ${host.store.dir} (${result.label})\n`); } await Promise.all([consumeEvents(host.events(), stderr), consumeStream(host.stream(), stdout)]); } finally { await host.close(); } }
async function consumeEvents(events: AsyncIterable<RuntimeEvent>, stderr: Writable) { for await (const event of events) { const progress = formatEvent(event); if (progress) stderr.write(`[${formatTime(event.time)}] [${event.type.toUpperCase()}] ${progress}\n`); } }
async function consumeStream(stream: AsyncIterable<string>, stdout: Writable) { let content = false; for await (const delta of stream) { if (delta === "\u0000clear") { if (content) stdout.write("\n\n"); content = false; } else if (delta) { stdout.write(delta); content = true; } } if (content) stdout.write("\n"); }
function replay(items: RuntimeQueueItem[], stdout: Writable, stderr: Writable) { for (const item of items) { if (item.kind === "ui_event" && item.summary) { const event = item.payload as RuntimeEvent | undefined; const progress = event?.type === "reflection" ? formatEvent(event) : item.summary; stderr.write(`[${formatTime(item.time)}] [${item.category ?? "SYSTEM"}] ${progress}\n`); } else if (item.kind === "stream_delta") { const payload = item.payload as { delta?: unknown } | undefined; if (typeof payload?.delta === "string") stdout.write(payload.delta); } else if (item.kind === "stream_clear") stdout.write("\n\n"); } }
function formatTime(time?: string) { if (!time) return "--:--:--"; const date = new Date(time); return Number.isNaN(date.valueOf()) ? "--:--:--" : date.toISOString().slice(11, 19); }
function formatEvent(event: RuntimeEvent): string | undefined {
  if (event.type !== "reflection" || !event.payload || typeof event.payload !== "object") return event.message?.trim() || undefined;
  const payload = event.payload as { phase?: string; round?: number; rounds?: number; maxRounds?: number; score?: number; passed?: boolean };
  const agent = event.agent ? `${event.agent.charAt(0).toUpperCase()}${event.agent.slice(1)} · ` : "";
  if (payload.phase === "started") return `${agent}开始反思 · 最多 ${payload.maxRounds} 轮`;
  if (payload.phase === "revision_started") return `${agent}开始第 ${payload.round} 轮修订`;
  if (payload.phase === "review_completed") return `${agent}第 ${payload.round} 轮评审 · ${payload.score} 分 · ${payload.passed ? "通过" : "待修订"}`;
  if (payload.phase === "completed") return `${agent}反思完成 · ${payload.rounds} 轮 · ${payload.score} 分 · ${payload.passed ? "通过" : "未通过"}`;
  return event.message?.trim() || undefined;
}
