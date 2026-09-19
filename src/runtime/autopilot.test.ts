import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../store/index.js";
import { AutopilotRunner, type AutopilotHostFacade } from "./autopilot.js";
import { emptyAutopilotState, stageOfPhase, isActivePhase } from "../domain/autopilot.js";
import { goldenChapterScore } from "../diag/golden.js";

/** mock host：按 continue 调用序执行脚本（写 premise/大纲/章节正文）。 */
function mockHost(script: Array<(prompt: string) => Promise<void>>, costUsd = 0): AutopilotHostFacade & { prompts: string[] } {
  const prompts: string[] = [];
  let cursor = 0;
  return {
    prompts,
    continue: async (prompt: string) => {
      prompts.push(prompt);
      const step = script[Math.min(cursor, script.length - 1)];
      cursor += 1;
      await step?.(prompt);
    },
    inject: async () => undefined,
    usage: { snapshot: () => ({ overall: { cost_usd: costUsd } }) },
  };
}

const GOOD_CHAPTER = "雨夜。\n他猛地回头——身后竟空无一人。\n“这么晚，你还敢来？”守门人冷笑。\n下一刻，钟声炸响。\n他攥紧湿透的衣角，血腥味混着铁锈气息涌上喉头。\n突然，灯灭了。\n然而他没有退。";
const WEAK_CHAPTER = "今天天气不错，他心情很好，出门散步，看了很多风景，然后回家了。";

async function seedStore(totalChapters = 2): Promise<{ store: Store; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "autopilot-"));
  const store = new Store(dir);
  await store.init();
  await store.progress.save({ novel_name: "", phase: "writing", current_chapter: 1, total_chapters: totalChapters, completed_chapters: [], total_word_count: 0, chapter_word_counts: {}, flow: "writing", in_progress_chapter: 0, completed_scenes: [], pending_rewrites: [], rewrite_reason: "", hook_history: [], strand_history: [], layered: false, current_volume: 0, current_arc: 0, reopened_from_complete: false });
  return { store, dir };
}

const settings = { checkpoint: "premise-outline" as const, scoreThreshold: 1, maxRewrites: 2 };
const noCheckpoint = { checkpoint: "none" as const, scoreThreshold: 1, maxRewrites: 2 };

async function waitFor(predicate: () => boolean, ticks = 200): Promise<void> {
  for (let index = 0; index < ticks && !predicate(); index += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(predicate()).toBe(true);
}

describe("autopilot domain", () => {
  it("provides schema defaults and phase helpers", () => {
    const state = emptyAutopilotState();
    expect(state.phase).toBe("idle");
    expect(state.settings).toEqual({ checkpoint: "premise-outline", scoreThreshold: 75, maxRewrites: 2 });
    expect(stageOfPhase("premise-review")).toBe("premise");
    expect(stageOfPhase("writing")).toBe("writing");
    expect(isActivePhase("idle")).toBe(false);
    expect(isActivePhase("writing")).toBe(true);
  });

  it("scores any chapter via goldenChapterScore", () => {
    expect(goldenChapterScore(7, GOOD_CHAPTER)?.score).toBeGreaterThan(0);
    expect(goldenChapterScore(7, "")).toBeNull();
  });
});

describe("AutopilotRunner", () => {
  it("runs premise checkpoint then outline checkpoint then completes all chapters", async () => {
    const { store, dir } = await seedStore(2);
    const host = mockHost([
      async () => { await store.outline.savePremise("少年逆袭的都市异能故事"); },
      async () => { await store.outline.saveOutline([{ chapter: 1, title: "开端", core_event: "e", hook: "h", scenes: [] }, { chapter: 2, title: "高潮", core_event: "e2", hook: "h2", scenes: [] }]); },
      async () => { await store.drafts.saveFinalChapter(1, GOOD_CHAPTER); },
      async () => { await store.drafts.saveFinalChapter(2, GOOD_CHAPTER); },
    ]);
    const runner = new AutopilotRunner(host, store);
    await runner.start("写一本都市异能小说", settings, 0);

    await waitFor(() => runner.getState().phase === "premise-review");
    expect(runner.getState().proposal).toContain("逆袭");
    await runner.proceed();

    await waitFor(() => runner.getState().phase === "outline-review");
    expect(runner.getState().proposal).toContain("第1章 开端");
    await runner.tweak("主线压缩为 2 章节奏");

    await waitFor(() => runner.getState().phase === "complete");
    const state = runner.getState();
    expect(state.adoptedCount).toBe(2);
    expect(state.reviewQueue).toEqual([]);
    expect(await store.drafts.loadChapterText(1)).toContain("钟声");
    const persisted = JSON.parse(await readFile(join(dir, "meta", "autopilot.json"), "utf8")) as { phase: string };
    expect(persisted.phase).toBe("complete");
  });

  it("rewrites below-threshold drafts and adopts once the gate passes", async () => {
    const { store } = await seedStore(1);
    const host = mockHost([
      async () => { await store.outline.savePremise("前提"); },
      async () => { await store.outline.saveOutline([{ chapter: 1, title: "开端", core_event: "e", hook: "h", scenes: [] }]); },
      async () => { /* 首稿为空：得分 0，必触重写 */ },
      async () => { await store.drafts.saveFinalChapter(1, GOOD_CHAPTER); },
    ]);
    const runner = new AutopilotRunner(host, store);
    await runner.start("想法", noCheckpoint, 0);
    await waitFor(() => runner.getState().phase === "complete");
    expect(host.prompts.some((prompt) => prompt.includes("[自动驾驶重写指令]"))).toBe(true);
    expect(runner.getState().lastScore).toBeGreaterThan(0);
    expect(await store.drafts.loadChapterText(1)).toContain("钟声");
  });

  it("marks the chapter for manual review after exhausting rewrites", async () => {
    const { store } = await seedStore(1);
    const host = mockHost([
      async () => { await store.outline.savePremise("前提"); },
      async () => { await store.outline.saveOutline([{ chapter: 1, title: "开端", core_event: "e", hook: "h", scenes: [] }]); },
      async () => { await store.drafts.saveFinalChapter(1, WEAK_CHAPTER); },
    ]);
    const strict = { checkpoint: "none" as const, scoreThreshold: 99, maxRewrites: 1 };
    const runner = new AutopilotRunner(host, store);
    await runner.start("想法", strict, 0);
    await waitFor(() => runner.getState().phase === "complete");
    const state = runner.getState();
    expect(state.reviewQueue).toEqual([1]);
    expect(state.adoptedCount).toBe(1);
    await runner.clearReview(1);
    expect(runner.getState().reviewQueue).toEqual([]);
  });

  it("stops at chapter boundaries on budget exhaustion and resumes from breakpoint", async () => {
    const { store } = await seedStore(2);
    let expensive = false;
    const host = mockHost([
      async () => { await store.outline.savePremise("前提"); },
      async () => { await store.outline.saveOutline([{ chapter: 1, title: "开端", core_event: "e", hook: "h", scenes: [] }, { chapter: 2, title: "结局", core_event: "e2", hook: "h2", scenes: [] }]); },
      async () => { await store.drafts.saveFinalChapter(1, GOOD_CHAPTER); expensive = true; },
      async () => { await store.drafts.saveFinalChapter(2, GOOD_CHAPTER); },
    ], 0);
    const facade: AutopilotHostFacade & { prompts: string[] } = {
      prompts: host.prompts,
      continue: async (prompt: string) => { await host.continue(prompt); },
      inject: async () => undefined,
      usage: { snapshot: () => ({ overall: { cost_usd: expensive ? 9 : 0 } }) },
    };
    const runner = new AutopilotRunner(facade, store);
    await runner.start("想法", noCheckpoint, 5);
    await waitFor(() => runner.getState().phase === "stopped");
    expect(runner.getState().error).toContain("预算");
    expect(runner.getState().adoptedCount).toBe(1);
    expensive = false;
    await runner.resume();
    await waitFor(() => runner.getState().phase === "complete");
    expect(runner.getState().adoptedCount).toBe(2);
  });

  it("pauses at review checkpoints and rejects tweaks outside checkpoints", async () => {
    const { store } = await seedStore(1);
    const host = mockHost([
      async () => { await store.outline.savePremise("原始前提"); },
      async () => { await store.outline.saveOutline([{ chapter: 1, title: "开端", core_event: "e", hook: "h", scenes: [] }]); },
      async () => { await store.drafts.saveFinalChapter(1, GOOD_CHAPTER); },
    ]);
    const runner = new AutopilotRunner(host, store);
    await runner.start("想法", settings, 0);
    await waitFor(() => runner.getState().phase === "premise-review");
    await runner.tweak("替换后的前提：悬疑侦探故事");
    expect(await store.outline.loadPremise()).toContain("侦探");
    await waitFor(() => runner.getState().phase === "outline-review");
    await runner.proceed();
    await waitFor(() => runner.getState().phase === "complete");
    await expect(runner.tweak("已完成后的微调")).rejects.toThrow();
    await expect(runner.proceed()).rejects.toThrow();
  });
});
