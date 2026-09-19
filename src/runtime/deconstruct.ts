import { splitChapters } from "./imp/index.js";
import { hookScore, thrillDensity } from "../diag/reader.js";

/**
 * 拆书分析（specs/2026-09-19-p4-competitive-parity R3）。
 * 任意小说文本 → 章节统计 + 三幕骨架 + 节奏曲线 + 爽点峰值 + 高频 bigram。只读纯计算。
 */

export interface ChapterStat { chapter: number; title: string; words: number; dialogueRatio: number; hookScore: number; thrillDensity: number }
export interface DeconstructReport {
  singleChapter: boolean;
  totalChapters: number;
  totalWords: number;
  chapters: ChapterStat[];
  acts: { act: "setup" | "confrontation" | "resolution"; fromChapter: number; toChapter: number; words: number; ratio: number }[];
  peaks: Array<{ chapter: number; title: string; composite: number }>;
  topBigrams: Array<{ term: string; count: number }>;
}

const STOP_BIGRAMS = new Set(["他们", "自己", "一个", "什么", "这个", "那个", "没有", "我们", "已经", "知道", "起来", "出来", "看到", "看着", "就是", "但是", "如果", "这样", "怎么", "现在", "时候"]);

function countWords(text: string): number { return [...text.replace(/\s/g, "")].length; }

export function deconstruct(rawText: string): DeconstructReport {
  const chapters = splitChapters(rawText);
  if (!chapters.length) throw new Error("文本为空，无法拆书");

  const stats: ChapterStat[] = chapters.map((item) => {
    const words = countWords(item.content);
    const chars = words || 1;
    const quoted = item.content.match(/[“"][^”"]{2,}[”"]/g)?.join("") ?? "";
    return {
      chapter: item.chapter,
      title: item.title,
      words,
      dialogueRatio: Math.round(([...quoted.replace(/\s/g, "")].length / chars) * 100) / 100,
      hookScore: hookScore(item.content),
      thrillDensity: Math.round(thrillDensity(item.content) * 100) / 100,
    };
  });

  const totalWords = stats.reduce((total, row) => total + row.words, 0);
  const boundaries = [Math.ceil(stats.length * 0.25), Math.ceil(stats.length * 0.75)];
  const segments: DeconstructReport["acts"] = [
    { act: "setup", fromChapter: stats[0]!.chapter, toChapter: stats[Math.max(0, boundaries[0]! - 1)]!.chapter, words: 0, ratio: 0 },
    { act: "confrontation", fromChapter: stats[boundaries[0]!]?.chapter ?? stats[0]!.chapter, toChapter: stats[Math.max(boundaries[0]!, boundaries[1]! - 1)]?.chapter ?? stats.at(-1)!.chapter, words: 0, ratio: 0 },
    { act: "resolution", fromChapter: stats[boundaries[1]!]?.chapter ?? stats.at(-1)!.chapter, toChapter: stats.at(-1)!.chapter, words: 0, ratio: 0 },
  ];
  const wordsTotal = totalWords || 1;
  const ranges: Array<[number, number]> = [[0, boundaries[0]!], [boundaries[0]!, boundaries[1]!], [boundaries[1]!, stats.length]];
  ranges.forEach(([start, end], index) => {
    const sum = stats.slice(start, end).reduce((total, row) => total + row.words, 0);
    segments[index]!.words = sum;
    segments[index]!.ratio = Math.round((sum / wordsTotal) * 100) / 100;
  });

  const maxThrill = Math.max(...stats.map((row) => row.thrillDensity), 1);
  const peaks = stats
    .map((row) => ({ chapter: row.chapter, title: row.title, composite: Math.round(((row.thrillDensity / maxThrill) * 0.6 + (row.hookScore / 100) * 0.4) * 100) }))
    .sort((a, b) => b.composite - a.composite)
    .slice(0, 3)
    .sort((a, b) => a.chapter - b.chapter);

  const bigramCounts = new Map<string, number>();
  for (const item of chapters) {
    for (const run of item.content.match(/[\u4e00-\u9fff]+/g) ?? []) {
      const chars = [...run];
      for (let index = 0; index + 1 < chars.length; index += 1) {
        const bigram = chars[index]! + chars[index + 1]!;
        if (STOP_BIGRAMS.has(bigram)) continue;
        bigramCounts.set(bigram, (bigramCounts.get(bigram) ?? 0) + 1);
      }
    }
  }
  const topBigrams = [...bigramCounts.entries()].filter(([, count]) => count >= 3).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([term, count]) => ({ term, count }));

  return {
    singleChapter: stats.length === 1,
    totalChapters: stats.length,
    totalWords,
    chapters: stats,
    acts: segments,
    peaks,
    topBigrams,
  };
}
