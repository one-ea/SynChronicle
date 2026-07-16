import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateText, streamText, tool } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createDeterministicTestModel } from "./fakeProvider.js";

describe("deterministic E2E Provider", () => {
  afterEach(() => {
    delete process.env.SYNCHRONICLE_E2E_PROVIDER_LOG;
    delete process.env.SYNCHRONICLE_E2E_FAKE_PROVIDER;
    vi.unstubAllEnvs();
  });

  it("records every generate and stream call with the selected model", async () => {
    vi.stubEnv("NODE_ENV", "test");
    process.env.SYNCHRONICLE_E2E_FAKE_PROVIDER = "1";
    const directory = await mkdtemp(join(tmpdir(), "synchronicle-provider-"));
    process.env.SYNCHRONICLE_E2E_PROVIDER_LOG = join(directory, "calls.jsonl");
    const model = createDeterministicTestModel("e2e", "deterministic-v2");

    await generateText({ model, prompt: "generate" });
    await (await streamText({ model, prompt: "stream" })).text;

    const calls = (await readFile(process.env.SYNCHRONICLE_E2E_PROVIDER_LOG, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(calls).toMatchObject([
      { method: "generate", provider: "e2e", model: "deterministic-v2" },
      { method: "stream", provider: "e2e", model: "deterministic-v2" },
    ]);
  });

  it("uses the real ask_user tool before continuing streamed output", async () => {
    vi.stubEnv("NODE_ENV", "test");
    process.env.SYNCHRONICLE_E2E_FAKE_PROVIDER = "1";
    const askUser = vi.fn(async () => "用户回答：[篇幅] 长篇");
    const result = streamText({
      model: createDeterministicTestModel("e2e", "deterministic"),
      prompt: "start",
      tools: {
        ask_user: tool({
          description: "ask",
          inputSchema: z.object({ questions: z.array(z.object({ header: z.string(), question: z.string(), options: z.array(z.object({ label: z.string(), description: z.string() })) })) }),
          execute: askUser,
        }),
      },
      stopWhen: ({ steps }) => steps.length >= 2,
    });

    await expect(result.text).resolves.toContain("雾港");
    expect(askUser).toHaveBeenCalledWith(expect.objectContaining({ questions: [expect.objectContaining({ question: "希望写多长？" })] }), expect.anything());
  });

  it("creates a real checkpoint through the switched model tool", async () => {
    vi.stubEnv("NODE_ENV", "test");
    process.env.SYNCHRONICLE_E2E_FAKE_PROVIDER = "1";
    const reopenBook = vi.fn(async () => ({ reopened: true }));
    const result = streamText({
      model: createDeterministicTestModel("e2e", "deterministic-v2"),
      prompt: "continue",
      tools: { reopen_book: tool({ description: "checkpoint", inputSchema: z.object({ chapters: z.array(z.number()), reason: z.string() }), execute: reopenBook }) },
      stopWhen: ({ steps }) => steps.length >= 2,
    });

    await expect(result.text).resolves.toContain("雾港");
    expect(reopenBook).toHaveBeenCalledWith(expect.objectContaining({ chapters: [1], reason: "crash recovery boundary" }), expect.anything());
  });
});
