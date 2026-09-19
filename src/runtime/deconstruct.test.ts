import { describe, expect, it } from "vitest";
import { deconstruct } from "./deconstruct.js";

const SAMPLE = [
  "# 第 1 章 雨夜",
  "沈砚推开书局的门。“这么晚还来？”苏晚问。他没答话，把湿透的外套挂在门后。雨声敲着屋檐，一整夜没有停过。他忽然想起十年前也是这样的雨夜，父亲就是从这扇门走出去，再也没有回来。",
  "# 第 2 章 回声",
  "旧钟楼的钥匙躺在掌心。“你打算什么时候打开它？”苏晚又问。杀意突然从背后袭来，沈砚反手拔刀，血光冲天。赢了——他在心里默念，终于赢了一局。然而钟声在这时响起。",
  "第 三 章 长街",
  "长街尽头有人等他。是顾长风，巡查署署长，十年前旧钟楼案的经办人。“你父亲留下的账本，在你手里吧。”沈砚握紧了袖中的钥匙，摇了摇头。",
].join("\n\n");

describe("deconstruct 拆书", () => {
  it("splits chapters, computes stats, acts, peaks and bigrams", () => {
    const report = deconstruct(SAMPLE);
    expect(report.singleChapter).toBe(false);
    expect(report.totalChapters).toBe(3);
    expect(report.chapters[0]!).toMatchObject({ chapter: 1, title: expect.stringContaining("雨夜") });
    expect(report.chapters[0]!.words).toBeGreaterThan(20);
    expect(report.chapters[1]!.hookScore).toBeGreaterThan(0);
    expect(report.acts).toHaveLength(3);
    const ratioSum = Math.round(report.acts.reduce((total, act) => total + act.ratio, 0));
    expect(ratioSum).toBe(1);
    expect(report.peaks.length).toBeGreaterThan(0);
    expect(report.peaks.length).toBeLessThanOrEqual(3);
    expect(report.totalWords).toBeGreaterThan(50);
  });

  it("falls back to single chapter analysis without markers", () => {
    const report = deconstruct("一段没有任何章节标记的正文。就这样。");
    expect(report.singleChapter).toBe(true);
    expect(report.totalChapters).toBe(1);
    expect(report.chapters[0]!.chapter).toBe(1);
  });

  it("throws on empty text", () => {
    expect(() => deconstruct("   ")).toThrow("文本为空");
  });
});
