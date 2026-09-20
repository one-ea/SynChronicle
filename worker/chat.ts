/**
 * P11-C5 边缘生成引擎：OpenAI 兼容流式对话。
 * 渠道解密 → chat/completions 流式转发 → SSE 推送 → 商用额度结算。
 */

import type { ChannelRow } from "../src/platform/dao.js";
import { lookupPrice } from "../src/diag/cost.js";

export interface ChatTurn { role: "user" | "assistant"; content: string; model?: string; usage?: { input: number; output: number }; time?: string }

export const CHAT_SYSTEM_PROMPT = "你是 SynChronicle 的创作助手。帮助用户构思、讨论和打磨长篇故事：给出具体、可执行的建议，保持创作者的意图与声音。";

/** 组装上游 chat/completions 请求（流式 + usage 回传）。 */
export function buildUpstreamRequest(channel: ChannelRow, apiKey: string, model: string, messages: Array<{ role: string; content: string }>): Request {
  const base = channel.base_url.replace(/\/$/, "");
  return new Request(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, stream: true, stream_options: { include_usage: true }, messages }),
  });
}

export interface UpstreamPiece { delta?: string; usage?: { input: number; output: number } }

/** 解析上游 SSE 流：data: {...} 增量与 usage，[DONE] 终止。 */
export async function* parseUpstreamStream(body: ReadableStream<Uint8Array>): AsyncGenerator<UpstreamPiece> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        yield* parseBlock(block);
        boundary = buffer.indexOf("\n\n");
      }
    }
    if (buffer.trim()) yield* parseBlock(buffer);
  } finally { await reader.cancel().catch(() => undefined); }
}

function* parseBlock(block: string): Generator<UpstreamPiece> {
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const chunk = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: unknown } }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
      const content = chunk.choices?.[0]?.delta?.content;
      if (typeof content === "string" && content) yield { delta: content };
      if (chunk.usage) yield { usage: { input: Number(chunk.usage.prompt_tokens ?? 0) || 0, output: Number(chunk.usage.completion_tokens ?? 0) || 0 } };
    } catch { /* 跳过坏块 */ }
  }
}

/** 结算成本（USD）：主线同款价格表。 */
export function settleCost(model: string, inputTokens: number, outputTokens: number): number {
  const price = lookupPrice(model);
  const cost = (inputTokens / 1000) * price.in + (outputTokens / 1000) * price.out;
  return Math.round(cost * 1e6) / 1e6;
}

export function sseEvent(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
