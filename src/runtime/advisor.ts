import type { Store } from "../store/index.js";
import type { Advice } from "../domain/advice.js";
import { ConstitutionSchema, emptyConstitution, isEmptyConstitution } from "../domain/constitution.js";
import { goldenChapterScore } from "../diag/golden.js";
import { detectAitone } from "../stylestat/aitone.js";
import { FileIO } from "../store/io.js";

export async function computeAdvice(store: Store, extra: { prepStage?: string; autopilotPhase?: string; budgetUsd?: number; costUsd?: number; reviewQueue?: number[] } = {}): Promise<Advice[]> {
  const now = new Date().toISOString();
  const make = (kind: Advice["kind"], severity: Advice["severity"], message: string, scope = "book", actionHint = ""): Advice => ({ id: `${kind}:${scope}`, kind, severity, message, scope, actionHint, bornAt: now });
  const advice: Advice[] = [];
  const [premise, outline, progress, entities, constitutionRaw, foreshadows] = await Promise.all([store.outline.loadPremise(), store.outline.loadOutline(), store.progress.load(), store.entities.load(), store.constitution.load().catch(() => null), store.foreshadows.load()]);
  if (extra.prepStage && !/(打|杀|冲突|背叛|危机|对抗)/.test(premise)) advice.push(make("prep-missing-conflict", "warn", "前提还缺核心冲突，主角到底在和什么对抗？"));
  if (premise && !entities.entities.some((entity) => premise.includes(entity.name))) advice.push(make("prep-missing-protagonist", "info", "主角还没露面，给 TA 一个名字和一句话人设"));
  if (extra.autopilotPhase && ["writing", "complete"].includes(extra.autopilotPhase) && !outline.length) advice.push(make("prep-outline-empty", "critical", "大纲是空的，继续写会散，先补卷弧章骨架"));
  const parsedConstitution = constitutionRaw ? ConstitutionSchema.safeParse(constitutionRaw) : null;
  if (extra.autopilotPhase === "writing" && isEmptyConstitution(parsedConstitution?.success ? parsedConstitution.data : emptyConstitution())) advice.push(make("constitution-empty", "warn", "项目宪法还是空的，长篇容易写崩"));
  const completed = [...(progress?.completed_chapters ?? [])].sort((a, b) => a - b).slice(-2);
  const scores: Array<{ chapter: number; golden: number; aitone: number }> = [];
  for (const chapter of completed) { const text = await store.drafts.loadChapterText(chapter); scores.push({ chapter, golden: goldenChapterScore(chapter, text)?.score ?? 0, aitone: detectAitone(text)?.score ?? 0 }); }
  if (scores.length === 2 && scores[0]!.golden - scores[1]!.golden >= 15) advice.push(make("score-drop", "warn", `第 ${scores[1]!.chapter} 章比上一章掉分明显`, `chapter:${scores[1]!.chapter}`));
  if (scores.length === 2 && scores.every((item) => item.golden < 70)) advice.push(make("consecutive-low", "critical", "连续两章低于安全线，建议先跑一次编辑审稿"));
  if ((extra.reviewQueue?.length ?? 0) >= 3) advice.push(make("review-queue-growing", "warn", "待复核章节持续积压，建议先清理"));
  if ((extra.budgetUsd ?? 0) > 0 && (extra.costUsd ?? 0) / extra.budgetUsd! >= 0.8) advice.push(make("budget-usage-high", "warn", "预算已使用八成"));
  if (scores.length === 2 && scores[1]!.aitone - scores[0]!.aitone >= 20) advice.push(make("aitone-worsening", "info", "最新一章 AI 味变重了"));
  const urgent = foreshadows.items.find((track) => track.missedRecoveries >= 2);
  if (urgent) advice.push(make("foreshadow-urgent", "warn", `伏笔「${urgent.title}」已经错过 2 次回收点`, `foreshadow:${urgent.id}`));
  const raw = await new FileIO(store.dir).readJSON<{ dismissed?: string[] }>("meta/advice.json");
  const dismissed = new Set(raw?.dismissed ?? []);
  return advice.filter((item) => !dismissed.has(item.id));
}
