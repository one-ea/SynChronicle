import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import { Store } from "../store/index.js";
import { prepareUserRules } from "./prepareUserRules.js";

type LanguageModelInstance = Exclude<LanguageModel, string>;

function mockModel(): LanguageModelInstance {
  return {
    specificationVersion: "v2",
    provider: "mock",
    modelId: "mock-model",
    supportedUrls: {},
    doGenerate: vi.fn(async () => ({
      finishReason: "stop" as const,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      content: [{ type: "text" as const, text: JSON.stringify({ structured: { genre: "玄幻" }, preferences: "对话占比要高", uncertain: [] }) }],
      warnings: [],
      response: { id: "r1", timestamp: new Date(), modelId: "mock-model" },
    })),
    doStream: vi.fn(),
  };
}

function mockModelSet(model: LanguageModelInstance) {
  return { forRole: vi.fn(() => model) } as never;
}

describe("prepareUserRules", () => {
  it("builds a snapshot from rules files and is idempotent afterwards", async () => {
    const home = mkdtempSync(join(tmpdir(), "rules-home-"));
    const rulesDir = join(home, ".synchronicle", "rules");
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(join(rulesDir, "01-style.md"), "对话占比要高，少用成语");
    const previousHome = process.env.HOME;
    process.env.HOME = home;

    const dir = mkdtempSync(join(tmpdir(), "rules-store-"));
    const store = new Store(dir);
    await store.init();
    const model = mockModel();
    const models = mockModelSet(model);
    try {
      await prepareUserRules(store, models);
      const snapshot = await store.userRules.load() as { status: string; structured: { genre: string }; sources: string[] };
      expect(snapshot.status).toBe("ready");
      expect(snapshot.structured.genre).toBe("玄幻");
      expect(snapshot.sources).toContain("global:01-style.md");

      // 幂等：已有快照不再归一化
      const callsBefore = (model.doGenerate as ReturnType<typeof vi.fn>).mock.calls.length;
      await prepareUserRules(store, models);
      expect((model.doGenerate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
  });

  it("skips silently when no rules files exist", async () => {
    const home = mkdtempSync(join(tmpdir(), "rules-empty-"));
    const previousHome = process.env.HOME;
    process.env.HOME = home;
    const dir = mkdtempSync(join(tmpdir(), "rules-store2-"));
    const store = new Store(dir);
    await store.init();
    const model = mockModel();
    try {
      await prepareUserRules(store, mockModelSet(model));
      expect(await store.userRules.load()).toBeNull();
      expect(model.doGenerate).not.toHaveBeenCalled();
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
  });
});
