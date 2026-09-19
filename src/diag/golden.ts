import type { Store } from "../store/index.js";
import { thrillDensity } from "./reader.js";

/**
 * 黄金三章诊断（specs/2026-09-19-p5-creation-workbench R4）。
 * 对已完成第 1-3 章做开局钩子/冲突密度/代入感/信息倾泻四维评审。只读纯计算。
 */

const IMMERSION_WORDS = ["光", "影", "声", "响", "气息", "味", "冷", "热", "烫", "凉", "湿", "糙", "软", "亮", "暗", "风", "雨", "雾"];
const EXPOSITION_MARKS = ["原来", "据说", "相传", "传闻", "早在", "多年以前", "自从"];

export interface GoldenDimensions { openingHook: number; conflict: number; immersion: number; infoDump: number }
export interface GoldenChapter { chapter: number; score: number; dimensions: GoldenDimensions; words: number }
export interface GoldenFinding { chapter: number; dimension: keyof GoldenDimensions; evidence: string }
export interface GoldenReport { reviewed: number; missing: number[]; chapters: GoldenChapter[]; findings: GoldenFinding[]; averageScore: number; verdict: string }

function clamp(value: number): number { return Math.max(0, Math.min(100, Math.round(value))); }

export function openingHookScore(text: string): number {
  const head = text.slice(0, 300);
  const marks = (head.match(/[？?]|突然|竟|赫然|就在这时|下一刻|然而/g) ?? []).length;
  const dialogue = (head.match(/[“"][^”"]{2,}[”"]/g) ?? []).length;
  return clamp(marks * 20 + dialogue * 12);
}

function immersionScore(text: string): number {
  const chars = [...text.replace(/\s/g, "")].length;
  if (!chars) return 0;
  let hits = 0;
  for (const word of IMMERSION_WORDS) hits += Math.max(0, text.split(word).length - 1);
  return clamp(((hits * 1000) / chars) * 8);
}

function infoDumpScore(text: string): number {
  const paragraphs = text.trim().split(/\n+/).filter(Boolean);
  if (!paragraphs.length) return 100;
  const long = paragraphs.filter((item) => [...item].length > 150).length;
  let exposition = 0;
  for (const mark of EXPOSITION_MARKS) exposition += Math.max(0, text.split(mark).length - 1);
  const longRatio = long / paragraphs.length;
  return clamp(100 - longRatio * 60 - exposition * 8);
}

export function goldenReview(chapters: Array<{ chapter: number; text: string }>): GoldenReport {
  const within = chapters.filter((item) => item.chapter >= 1 && item.chapter <= 3);
  const missing = [1, 2, 3].filter((chapter) => !within.some((item) => item.chapter === chapter));
  const rows: GoldenChapter[] = [];
  const findings: GoldenFinding[] = [];
  for (const item of within) {
    if (!item.text.trim()) continue;
    const dimensions: GoldenDimensions = {
      openingHook: openingHookScore(item.text),
      conflict: clamp(thrillDensity(item.text) * 10),
      immersion: immersionScore(item.text),
      infoDump: infoDumpScore(item.text),
    };
    const score = clamp(dimensions.openingHook * 0.35 + dimensions.conflict * 0.3 + dimensions.immersion * 0.2 + dimensions.infoDump * 0.15);
    rows.push({ chapter: item.chapter, score, dimensions, words: [...item.text.replace(/\s/g, "")].length });
    for (const [key, value] of Object.entries(dimensions) as Array<[keyof GoldenDimensions, number]>) {
      if (key === "infoDump" ? value < 50 : value < 40) {
        const label: Record<keyof GoldenDimensions, string> = { openingHook: "开局钩子", conflict: "冲突密度", immersion: "代入感", infoDump: "信息倾泻" };
        findings.push({ chapter: item.chapter, dimension: key, evidence: `第 ${item.chapter} 章${label[key]}得分 ${value}，低于安全线` });
      }
    }
  }
  const averageScore = rows.length ? Math.round(rows.reduce((total, row) => total + row.score, 0) / rows.length) : 0;
  const verdict = !rows.length ? "暂无可评审章节" : averageScore >= 70 ? "开局合格" : averageScore >= 50 ? "开局偏弱，建议打磨前三章" : "开局不及格，建议重写黄金三章";
  return { reviewed: rows.length, missing, chapters: rows, findings, averageScore, verdict };
}

export async function goldenReviewFromStore(store: Store): Promise<GoldenReport> {
  const progress = await store.progress.load();
  const completed = [...(progress?.completed_chapters ?? [])].sort((a, b) => a - b);
  const chapters: Array<{ chapter: number; text: string }> = [];
  for (const chapter of completed.filter((item) => item <= 3)) {
    const text = await store.drafts.loadChapterText(chapter);
    if (text) chapters.push({ chapter, text });
  }
  return goldenReview(chapters);
}
