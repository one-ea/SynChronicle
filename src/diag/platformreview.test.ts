import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "../store/index.js";
import { platformReviewFromStore } from "./platformreview.js";

async function seed(hookText: string) {
  const dir = await mkdtemp(join(tmpdir(), "platform-"));
  const store = new Store(dir);
  await store.init();
  await store.outline.saveOutline([
    { chapter: 1, title: "雨夜", core_event: "发现钥匙", hook: "钟声", scenes: ["书局"] },
    { chapter: 2, title: "回声", core_event: "遭遇袭击", hook: "黑影", scenes: ["长街"] },
    { chapter: 3, title: "长街", core_event: "对峙署长", hook: "账本", scenes: ["长街"] },
  ]);
  await store.outline.saveCompass({ ending_direction: "揭开旧钟楼真相并和解" });
  for (const [chapter, text] of [[1, hookText], [2, "他拔刀迎上，血光冲天。杀意如潮。突然，黑影扑下——"], [3, "钟声再起。顾长风现身长街尽头。“账本呢？”"]]) {
    await store.drafts.saveFinalChapter(chapter as number, text as string);
  }
  await store.progress.save({ novel_name: "测试", phase: "writing", current_chapter: 4, total_chapters: 12, completed_chapters: [1, 2, 3], total_word_count: 120, chapter_word_counts: { "1": 50, "2": 40, "3": 30 } });
  return store;
}

describe("platformreview 平台责编", () => {
  it("scores dimensions and applies platform-specific weights", async () => {
    const store = await seed("沈砚推开书局的门。“这么晚还来？”他忽然想起十年前的雨夜。突然，钟声响了。");
    const fanqie = await platformReviewFromStore(store, "fanqie");
    const qidian = await platformReviewFromStore(store, "qidian");
    expect(fanqie.weights.thrill).toBeGreaterThan(qidian.weights.thrill);
    expect(qidian.weights.mainline).toBeGreaterThan(fanqie.weights.mainline);
    expect(fanqie.dimensions.openingHook).toBeGreaterThan(0);
    expect(fanqie.dimensions.mainline).toBe(100);
    expect(fanqie.missing).toEqual([]);
    expect(fanqie.overall).toBeGreaterThanOrEqual(0);
    expect(fanqie.verdict.length).toBeGreaterThan(0);
  });

  it("flags weak opening as high-frequency rejection finding", async () => {
    const store = await seed("这个镇子很有历史。原来很久以前这里有一座山。多年以前人们过着平静的生活。据说山里有一条河。");
    const report = await platformReviewFromStore(store, "fanqie");
    expect(report.findings.some((finding) => finding.check === "开篇慢热")).toBe(true);
  });

  it("marks missing dimensions without chapters", async () => {
    const dir = await mkdtemp(join(tmpdir(), "platform-empty-"));
    const store = new Store(dir);
    await store.init();
    const report = await platformReviewFromStore(store, "qidian");
    expect(report.missing.length).toBeGreaterThan(0);
    expect(report.dimensions.openingHook).toBe(0);
  });
});
