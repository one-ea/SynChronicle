import type { Store } from "../store/index.js";
import { thrillDensity, hookScore } from "./reader.js";
import { openingHookScore } from "./golden.js";

/**
 * 平台定制 AI 责编（specs/2026-09-19-p6-consistency-and-platform R2）。
 * 番茄/起点签约 5 维打分：开篇钩子/主线清晰度/爽点密度/节奏紧凑度/结尾悬念。
 */

export type Platform = "fanqie" | "qidian";

export interface PlatformDimensions { openingHook: number; mainline: number; thrill: number; pacing: number; endingSuspense: number }
export interface PlatformFinding { check: string; evidence: string }
export interface PlatformReport {
  platform: Platform;
  dimensions: PlatformDimensions;
  overall: number;
  verdict: string;
  findings: PlatformFinding[];
  weights: Record<keyof PlatformDimensions, number>;
  missing: string[];
}

const WEIGHTS: Record<Platform, Record<keyof PlatformDimensions, number>> = {
  // 番茄：爽点密度与钩子权重高；起点：主线清晰度与节奏权重高
  fanqie: { thrill: 0.3, openingHook: 0.25, pacing: 0.2, endingSuspense: 0.15, mainline: 0.1 },
  qidian: { mainline: 0.3, pacing: 0.25, openingHook: 0.2, thrill: 0.15, endingSuspense: 0.1 },
};

function clamp(value: number): number { return Math.max(0, Math.min(100, Math.round(value))); }

export async function platformReviewFromStore(store: Store, platform: Platform): Promise<PlatformReport> {
  const missing: string[] = [];
  const progress = await store.progress.load();
  const completed = [...(progress?.completed_chapters ?? [])].sort((a, b) => a - b);
  const outline = await store.outline.loadOutline();

  const early: number[] = [];
  const recent: number[] = [];
  const thrills: number[] = [];
  const words: number[] = [];
  for (const chapter of completed) {
    const text = await store.drafts.loadChapterText(chapter);
    if (!text) continue;
    words.push([...text.replace(/\s/g, "")].length);
    if (chapter <= 3) early.push(openingHookScore(text));
    thrills.push(thrillDensity(text));
    recent.push(hookScore(text));
  }

  const openingHook = early.length ? clamp(early.reduce((total, value) => total + value, 0) / early.length) : 0;
  if (!early.length) missing.push("前三章");

  const compass = await store.outline.loadCompass();
  const withCoreEvent = outline.filter((entry) => entry.core_event.trim()).length;
  const mainline = clamp((outline.length ? (withCoreEvent / outline.length) * 80 : 0) + (compass?.ending_direction?.trim() ? 20 : 0));
  if (!outline.length) missing.push("大纲");

  const thrill = thrills.length ? clamp((thrills.reduce((total, value) => total + value, 0) / thrills.length) * 10) : 0;
  if (!thrills.length) missing.push("已完成章节");

  let pacing = 0;
  if (words.length >= 3) {
    const mean = words.reduce((total, value) => total + value, 0) / words.length || 1;
    const variance = words.reduce((total, value) => total + (value - mean) ** 2, 0) / words.length;
    pacing = clamp(100 - Math.sqrt(variance) / mean * 150);
  } else if (words.length) {
    pacing = 60;
    missing.push("节奏（章节不足 3 章）");
  } else missing.push("节奏");

  const endingSuspense = recent.length ? clamp(recent.slice(-3).reduce((total, value) => total + value, 0) / Math.min(3, recent.length)) : 0;

  const dimensions: PlatformDimensions = { openingHook, mainline, thrill, pacing, endingSuspense };
  const weights = WEIGHTS[platform];
  const overall = clamp(openingHook * weights.openingHook + mainline * weights.mainline + thrill * weights.thrill + pacing * weights.pacing + endingSuspense * weights.endingSuspense);

  const findings: PlatformFinding[] = [];
  if (openingHook < 40) findings.push({ check: "开篇慢热", evidence: `开篇钩子 ${openingHook}，前三章缺乏悬念钩子，是拒稿高频问题` });
  if (mainline < 40) findings.push({ check: "主线模糊", evidence: `主线清晰度 ${mainline}，大纲核心事件覆盖不足或缺少结局方向` });
  if (thrill < 40) findings.push({ check: "爽点稀疏", evidence: `爽点密度 ${thrill}，正文中冲突/爆点要素偏少` });
  if (pacing < 40) findings.push({ check: "节奏拖沓", evidence: `节奏紧凑度 ${pacing}，章节字数波动过大或整体拖沓` });
  if (endingSuspense < 40) findings.push({ check: "结尾平淡", evidence: `结尾悬念 ${endingSuspense}，最近章节收尾缺乏追更钩子` });

  const verdict = overall >= 70 ? "签约潜力较高" : overall >= 50 ? "具备签约基础，建议按 findings 打磨" : "距签约线尚远，建议重点整改 findings";
  return { platform, dimensions, overall, verdict, findings, weights, missing };
}
