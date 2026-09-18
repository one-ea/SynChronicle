/**
 * 伏笔到期提醒（specs/2026-09-18-p1-quality-depth R2，只警告不拦截）。
 * compass.open_threads 的每条线索在已完成章正文中检索最近提及（bigram 命中 ≥2 视为提及），
 * 断档超过阈值产出 warning finding。
 */
import type { Store } from "../store/index.js";
import { tokenize } from "../retrieval/bm25.js";
import type { Finding } from "./diagnose.js";

export const FORESHADOW_ABSENCE = 10;

const WARNING = "warning" as const;
const CRITICAL = "critical" as const;

export async function foreshadowFindings(store: Store): Promise<Finding[]> {
  const compass = await store.outline.loadCompass();
  const threads = compass?.open_threads ?? [];
  if (!threads.length) return [];
  const progress = await store.progress.load();
  const completed = [...(progress?.completed_chapters ?? [])].sort((a, b) => a - b);
  if (!completed.length) return [];

  const texts = new Map<number, string>();
  for (const chapter of completed) {
    const text = await store.drafts.loadChapterText(chapter);
    if (text) texts.set(chapter, text);
  }

  const findings: Finding[] = [];
  const isNearEnd = Boolean(
    progress?.phase === "complete" ||
    (progress?.total_chapters && completed.length >= progress.total_chapters * 0.85)
  );

  for (const thread of threads) {
    const tokens = [...new Set(tokenize(thread))];
    if (!tokens.length) continue;
    let lastMention = 0;
    for (const [chapter, text] of texts) {
      let hits = 0;
      for (const token of tokens) if (text.includes(token)) hits += 1;
      if (hits >= 2 && chapter > lastMention) lastMention = chapter;
    }

    // 终局/收官阶段未收线伏笔发出 critical 报警
    if (isNearEnd) {
      findings.push({
        rule: "ForeshadowLeak.unresolved",
        severity: CRITICAL,
        title: "全书收官伏笔遗漏",
        evidence: `『${thread}』在全书接近尾声（第 ${completed.length}/${progress?.total_chapters ?? completed.length} 章）仍未收束闭环，严防烂尾`,
      });
      continue;
    }

    if (lastMention && completed.length - lastMention > FORESHADOW_ABSENCE) {
      findings.push({ rule: "ForeshadowStall.stale", severity: WARNING, title: "伏笔长期未推进", evidence: `『${thread}』最近提及于第 ${lastMention} 章，距今 ${completed.length - lastMention} 章（红线 ${FORESHADOW_ABSENCE} 章）` });
    } else if (!lastMention && completed.length > FORESHADOW_ABSENCE) {
      findings.push({ rule: "ForeshadowStall.absent", severity: WARNING, title: "伏笔从未被推进", evidence: `『${thread}』在已完成的 ${completed.length} 章正文中从未出现，考虑回收或移出 open_threads` });
    }
  }
  return findings;
}
