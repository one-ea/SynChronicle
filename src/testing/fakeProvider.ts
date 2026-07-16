import { MockLanguageModelV2, simulateReadableStream } from "ai/test";

const text = "雾港的潮声越过窗沿，信纸上的墨迹仍带着远方的盐味。";
const usage = { inputTokens: 8, outputTokens: 16, totalTokens: 24 };

export function createDeterministicTestModel(provider: string, modelId: string) {
  if (process.env.NODE_ENV !== "test" || process.env.SYNCHRONICLE_E2E_FAKE_PROVIDER !== "1") {
    throw new Error("deterministic Provider is restricted to explicit test execution");
  }
  return new MockLanguageModelV2({
    provider,
    modelId,
    doGenerate: async () => ({ content: [{ type: "text", text }], finishReason: "stop", usage, warnings: [] }),
    doStream: async () => ({
      stream: simulateReadableStream({
        initialDelayInMs: 100,
        chunkDelayInMs: 50,
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "e2e-text" },
          { type: "text-delta", id: "e2e-text", delta: text },
          { type: "text-end", id: "e2e-text" },
          { type: "finish", finishReason: "stop", usage },
        ],
      }),
    }),
  });
}
