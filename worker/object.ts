/**
 * RuntimeHub Durable Object：每个 userId:bookId 一个实例。
 * - POST /events（内部令牌）：写入事件/快照并扇出给 SSE 订阅者
 * - GET /stream：SSE 流（回放 + 实时 + 每 5 秒注释心跳）
 * - GET /snapshot：最近快照 + 回放日志
 * 快照持久化到 DO storage，实例重启后仍可恢复状态展示。
 */

import type { DurableObjectState } from "@cloudflare/workers-types";
import { EventHub, type HubEvent } from "./hub.js";

interface HubEnv { INTERNAL_TOKEN?: string }

const encoder = new TextEncoder();

function sseChunk(event: HubEvent): Uint8Array {
  return encoder.encode(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
}

export class RuntimeHub {
  private readonly hub = new EventHub();

  constructor(private readonly ctx: DurableObjectState, private readonly env: HubEnv) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/events") return this.ingest(request);
    if (request.method === "GET" && url.pathname === "/stream") return this.stream();
    if (request.method === "GET" && url.pathname === "/snapshot") return this.snapshot();
    return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "content-type": "application/json" } });
  }

  private async ingest(request: Request): Promise<Response> {
    const token = request.headers.get("x-internal-token") ?? "";
    if (!this.env.INTERNAL_TOKEN || token !== this.env.INTERNAL_TOKEN) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
    const body = await request.json().catch(() => null) as { event?: unknown; data?: unknown } | null;
    if (!body || typeof body.event !== "string" || body.event.length > 64) return new Response(JSON.stringify({ error: "bad request" }), { status: 400 });
    this.hub.publish(body.event, body.data);
    if (body.event === "snapshot") await this.ctx.storage.put("snapshot", body.data).catch(() => undefined);
    return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  }

  private async stream(): Promise<Response> {
    const initial: Uint8Array[] = [];
    const stored = await this.ctx.storage.get("snapshot").catch(() => null);
    const snapshot = this.hub.currentSnapshot() ?? stored;
    if (snapshot !== null && snapshot !== undefined) initial.push(sseChunk({ event: "snapshot", data: snapshot }));
    for (const item of this.hub.replay()) initial.push(sseChunk(item));
    let unsubscribe: () => void = () => {};
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        for (const chunk of initial) controller.enqueue(chunk);
        unsubscribe = this.hub.subscribe((event) => { try { controller.enqueue(sseChunk(event)); } catch { /* 订阅者已断开 */ } });
      },
      cancel: () => { unsubscribe(); },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" } });
  }

  private async snapshot(): Promise<Response> {
    const stored = await this.ctx.storage.get("snapshot").catch(() => null);
    return new Response(JSON.stringify({ snapshot: this.hub.currentSnapshot() ?? stored, events: this.hub.replay() }), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  }
}
