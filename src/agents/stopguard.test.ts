import { describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { createAgent, StopBlockedError } from "./agent.js";

type LanguageModelInstance = Exclude<LanguageModel, string>;

function generated(text: string) {
  return {
    finishReason: "stop" as const,
    usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    content: [{ type: "text" as const, text }],
    warnings: [],
  };
}

function mockModel(provider: string): LanguageModelInstance {
  return {
    specificationVersion: "v2",
    provider,
    modelId: `${provider}-model`,
    supportedUrls: {},
    doGenerate: vi.fn(async () => generated("ok")),
    doStream: vi.fn(),
  };
}

describe("CheckpointDeltaGuard (stopGuard)", () => {
  it("blocks a stop without a new checkpoint, retries with a reminder, and gives up at maxBlocked", async () => {
    const model = mockModel("mock");
    const probe = vi.fn(async () => 0);
    const agent = createAgent({
      name: "writer",
      model,
      system: "sys",
      stopGuard: { probe, maxBlocked: 2 },
    });
    await expect(agent.generate("write the chapter")).rejects.toBeInstanceOf(StopBlockedError);
    const calls = (model.doGenerate as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(2);
    const secondMessages = calls[1]?.[0]?.prompt as Array<{ role: string; content: unknown }>;
    const lastPart = (secondMessages.at(-1) as { content: Array<{ type: string; text?: string }> }).content; const text = Array.isArray(lastPart) ? lastPart.map(p => p.text ?? "").join("") : String(lastPart); expect(text).toContain("[进度守护]");
  });

  it("allows the stop once a checkpoint appears after a retry", async () => {
    const model = mockModel("mock");
    const doGenerate = model.doGenerate as ReturnType<typeof vi.fn>;
    doGenerate
      .mockResolvedValueOnce({
        finishReason: "tool-calls" as const,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        content: [{ type: "tool-call" as const, toolCallId: "c1", toolName: "fake_commit", input: "{}" }],
        warnings: [],
        response: { id: "r1", timestamp: new Date(), modelId: "mock-model" },
      })
      .mockResolvedValueOnce({ ...generated("ok"), response: { id: "r2", timestamp: new Date(), modelId: "mock-model" } });
    let checkpointCount = 0;
    const agent = createAgent({
      name: "writer",
      model,
      system: "sys",
      tools: {
        fake_commit: {
          description: "fake",
          inputSchema: z.object({}),
          execute: async () => { checkpointCount += 1; return { committed: true }; },
        },
      },
      stopGuard: { probe: async () => checkpointCount, maxBlocked: 3 },
    });
    const result = await agent.generate("write the chapter");
    expect(result.text).toBe("ok");
    expect(checkpointCount).toBe(1);
    expect(doGenerate).toHaveBeenCalledTimes(2);
  });

  it("does not block when requireProgress returns false", async () => {
    const model = mockModel("mock");
    const agent = createAgent({
      name: "coordinator",
      model,
      system: "sys",
      stopGuard: { probe: async () => 0, requireProgress: async () => false },
    });
    await expect(agent.generate("裁定")).resolves.toMatchObject({ text: "ok" });
  });
});

describe("prompt cache breakpoint", () => {
  it("annotates the last user message with an anthropic cacheControl breakpoint", async () => {
    const model = mockModel("anthropic");
    const agent = createAgent({ name: "writer", model, system: "sys" });
    await agent.generate("hello");
    const calls = (model.doGenerate as ReturnType<typeof vi.fn>).mock.calls;
    const messages = calls[0]?.[0]?.prompt as Array<{ role: string; providerOptions?: unknown }>;
    const last = messages.at(-1) as { role: string; providerOptions?: { anthropic?: { cacheControl?: unknown } } };
    expect(last.role).toBe("user");
    expect(last.providerOptions?.anthropic?.cacheControl).toEqual({ type: "ephemeral" });
    // history 不被污染：第二次调用时第一条消息不再带断点
    await agent.generate("again");
    const secondMessages = calls[1]?.[0]?.prompt as Array<{ providerOptions?: unknown }>;
    const firstAgain = secondMessages[0] as { providerOptions?: unknown };
    expect(firstAgain.providerOptions).toBeUndefined();
  });

  it("does not annotate non-anthropic providers", async () => {
    const model = mockModel("mock");
    const agent = createAgent({ name: "writer", model, system: "sys" });
    await agent.generate("hello");
    const calls = (model.doGenerate as ReturnType<typeof vi.fn>).mock.calls;
    const messages = calls[0]?.[0]?.prompt as Array<{ providerOptions?: unknown }>;
    for (const message of messages) expect(message.providerOptions).toBeUndefined();
  });
});
