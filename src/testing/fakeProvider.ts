import { appendFileSync } from "node:fs";
import type { LanguageModel } from "ai";

const text = "雾港的潮声越过窗沿，信纸上的墨迹仍带着远方的盐味。";
const usage = { inputTokens: 8, outputTokens: 16, totalTokens: 24 };

export function createDeterministicTestModel(provider: string, modelId: string) {
  if (process.env.NODE_ENV !== "test" || process.env.SYNCHRONICLE_E2E_FAKE_PROVIDER !== "1") {
    throw new Error("deterministic Provider is restricted to explicit test execution");
  }
  const record = (method: "generate" | "stream", prompt: unknown) => {
    const path = process.env.SYNCHRONICLE_E2E_PROVIDER_LOG;
    if (!path) return;
    appendFileSync(path, `${JSON.stringify({ method, provider, model: modelId, workerId: process.env.WORKER_ID, pid: process.pid, timestamp: new Date().toISOString(), prompt })}\n`, { encoding: "utf8", mode: 0o600 });
  };
  let streamCalls = 0;
  const model = {
    specificationVersion: "v2" as const,
    provider,
    modelId,
    supportedUrls: {},
    doGenerate: async (options: { prompt: unknown }) => {
      record("generate", options.prompt);
      return { content: [{ type: "text" as const, text }], finishReason: "stop" as const, usage, warnings: [] };
    },
    doStream: async (options: { prompt: unknown; tools?: unknown }) => {
      record("stream", options.prompt);
      streamCalls += 1;
      const tools = JSON.stringify(options.tools ?? null);
      const hasAskUser = tools.includes("ask_user");
      const hasReopenBook = tools.includes("reopen_book");
      const delayMs = Number(process.env.SYNCHRONICLE_E2E_PROVIDER_DELAY_MS ?? 50);
      const toolCall = modelId === "deterministic" && streamCalls === 1 && hasAskUser
        ? { toolCallId: "e2e-ask", toolName: "ask_user", input: JSON.stringify({ questions: [{ header: "篇幅", question: "希望写多长？", options: [{ label: "长篇", description: "完整长篇" }, { label: "短篇", description: "精炼短篇" }] }] }) }
        : modelId === "deterministic-v2" && streamCalls === 1 && hasReopenBook
          ? { toolCallId: "e2e-checkpoint", toolName: "reopen_book", input: JSON.stringify({ chapters: [1], reason: "crash recovery boundary" }) }
          : null;
      const chunks: unknown[] = toolCall
        ? [
            { type: "stream-start", warnings: [] },
            { type: "tool-call", ...toolCall },
            { type: "finish", finishReason: "tool-calls", usage },
          ]
        : [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "e2e-text" },
            { type: "text-delta", id: "e2e-text", delta: text },
            { type: "text-end", id: "e2e-text" },
            { type: "finish", finishReason: "stop", usage },
          ];
      return { stream: delayedStream(chunks, delayMs) };
    },
  };
  return model as Exclude<LanguageModel, string>;
}

function delayedStream(chunks: unknown[], delayMs: number): ReadableStream<never> {
  return new ReadableStream({
    start(controller) {
      void (async () => {
        for (const chunk of chunks) {
          if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
          controller.enqueue(chunk as never);
        }
        controller.close();
      })();
    },
  });
}
