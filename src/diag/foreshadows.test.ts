import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "../store/index.js";
import { foreshadowFindings } from "./foreshadow.js";
import { buildRecallCorpus, recall } from "../retrieval/recall.js";

async function seed(missedRecoveries = 0) {
  const dir = await mkdtemp(join(tmpdir(), "foreshadows-"));
  const store = new Store(dir);
  await store.init();
  await store.drafts.saveFinalChapter(1, "沈砚发现旧钟楼的钥匙。他握紧了钥匙。钥匙很冷。");
  await store.progress.save({ novel_name: "测试", phase: "writing", current_chapter: 2, total_chapters: 10, completed_chapters: [1], total_word_count: 30, chapter_word_counts: { "1": 30 } });
  await store.foreshadows.upsert({
    id: "key-secret",
    title: "旧钟楼的钥匙",
    description: "钥匙能打开旧钟楼底层的暗室",
    type: "chekhov",
    stage: "planted",
    plantedChapter: 1,
    urgency: "medium",
    missedRecoveries,
  });
  return store;
}

describe("foreshadows 结构化伏笔", () => {
  it("escalates to critical when missed recoveries reach 3", async () => {
    const watchStore = await seed(1);
    const watch = await foreshadowFindings(watchStore);
    expect(watch.some((finding) => finding.rule === "ForeshadowEscalation.watch")).toBe(true);

    const criticalStore = await seed(3);
    const critical = await foreshadowFindings(criticalStore);
    expect(critical.some((finding) => finding.rule === "ForeshadowEscalation.critical" && finding.severity === "critical")).toBe(true);
  });

  it("feeds structured tracks into recall corpus with type", async () => {
    const store = await seed(0);
    const corpus = await buildRecallCorpus(store);
    const track = corpus.find((doc) => doc.kind === "foreshadow" && doc.source === "旧钟楼的钥匙");
    expect(track).toBeDefined();
    expect(track!.text).toContain("chekhov");
    const result = await recall(store, "旧钟楼 钥匙 暗室");
    expect(result.hits.length).toBeGreaterThan(0);
  });
});
