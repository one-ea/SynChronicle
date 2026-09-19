import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "../store/index.js";
import { editorReview } from "./editorreview.js";

async function makeStore(premise: string, chapterText?: string) {
  const dir = await mkdtemp(join(tmpdir(), "editor-"));
  const store = new Store(dir);
  await store.init();
  await store.outline.savePremise(premise);
  if (chapterText) {
    await store.drafts.saveFinalChapter(1, chapterText);
    await store.progress.save({ novel_name: "测试", phase: "writing", current_chapter: 2, total_chapters: 10, completed_chapters: [1], total_word_count: 30, chapter_word_counts: { "1": 30 } });
  }
  return store;
}

describe("editor 编辑视角审稿", () => {
  it("returns clean verdict for a solid book", async () => {
    const store = await makeStore("少年沈砚为查父亲失踪真相，凭一本旧账本在雨夜书局掀开全城阴谋，一步步逆袭翻盘，杀回旧钟楼。");
    await store.entities.upsertEntity({ id: "shen", name: "沈砚", type: "character", aliases: [], description: "书局掌柜，执意为父复仇", relations: [], states: [{ chapter: 1, mood: "警觉", goals: ["复仇"] }] });
    const report = await editorReview(store);
    expect(report.risks.some((risk) => risk.check === "题材撞车")).toBe(false);
    expect(report.risks.some((risk) => risk.check === "卖点模糊")).toBe(false);
    expect(report.risks.some((risk) => risk.check === "人设单薄")).toBe(false);
    expect(report.verdict).toBe("可投稿");
  });

  it("flags trope clash, weak selling, thin characters", async () => {
    const store = await makeStore("一个穿越重生的系统文故事。");
    await store.entities.upsertEntity({ id: "hero", name: "林辰", type: "character", aliases: [], description: "", relations: [], states: [] });
    const report = await editorReview(store);
    expect(report.risks.some((risk) => risk.check === "题材撞车")).toBe(true);
    expect(report.risks.some((risk) => risk.check === "卖点模糊")).toBe(true);
    expect(report.risks.some((risk) => risk.check === "人设单薄")).toBe(true);
    expect(report.verdict).toBe("建议大改");
  });

  it("flags pov chaos when first and third person mix", async () => {
    const store = await makeStore("少年沈砚为父复仇，逆袭崛起，一雪前耻。", "我推开门，看见沈砚站在灯下。沈砚抬起头，沈砚笑了笑。");
    const report = await editorReview(store);
    expect(report.risks.some((risk) => risk.check === "视角混乱")).toBe(true);
    expect(report.verdict).not.toBe("可投稿");
  });
});
