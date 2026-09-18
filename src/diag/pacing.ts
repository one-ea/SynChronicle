/**
 * 节奏红线诊断（specs/2026-09-18-quality-trio，只警告不拦截）。
 * 阈值参考业界连载实践（Webnovel Writer）：主线连续 ≤5 章、叙事线缺席 ≤10 章、整体断档 ≤15 章。
 */
import type { Progress } from "../domain/index.js";
import type { Finding } from "./diagnose.js";

export const PACING_LIMITS = { mainlineRun: 5, strandAbsence: 10, overallStall: 15 } as const;

const WARNING = "warning" as const;

export function pacingFindings(progress: Progress): Finding[] {
  const history = (progress.strand_history ?? []).filter(Boolean);
  if (history.length < 2) return [];
  const findings: Finding[] = [];
  const completed = progress.completed_chapters.length;

  let run = 1;
  for (let index = history.length - 2; index >= 0; index -= 1) {
    if (history[index] === history[history.length - 1]) run += 1;
    else break;
  }
  if (run > PACING_LIMITS.mainlineRun) {
    findings.push({ rule: "PacingStall.mainline_run", severity: WARNING, title: "主导叙事线连续过久", evidence: `『${history[history.length - 1]}』已连续 ${run} 章（红线 ${PACING_LIMITS.mainlineRun} 章），建议切一条支线调剂节奏` });
  }

  const lastSeen = new Map<string, number>();
  history.forEach((strand, index) => lastSeen.set(strand, index));
  const current = history[history.length - 1]!;
  for (const [strand, index] of lastSeen) {
    if (strand === current) continue;
    const absence = history.length - 1 - index;
    if (absence > PACING_LIMITS.strandAbsence) {
      findings.push({ rule: "PacingStall.strand_absence", severity: WARNING, title: "叙事线长期缺席", evidence: `『${strand}』已 ${absence} 章未推进（红线 ${PACING_LIMITS.strandAbsence} 章），再不回归可能被读者遗忘` });
    }
  }

  const gap = completed - history.length;
  if (gap > PACING_LIMITS.overallStall) {
    findings.push({ rule: "PacingStall.overall_stall", severity: WARNING, title: "主线整体断档", evidence: `已完成 ${completed} 章中 ${gap} 章缺少叙事线记录（红线 ${PACING_LIMITS.overallStall} 章），检查 commit_chapter 的 dominant_strand 是否漏填` });
  }

  return findings;
}
