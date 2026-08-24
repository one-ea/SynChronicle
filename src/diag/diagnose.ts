import type { Store } from "../store/index.js";
import { FileIO } from "../store/io.js";

/**
 * 确定性事实诊断器：对任意产出目录跑一套只读工件规则 + 运行时规则，
 * 产出 Report{Stats, Findings}。评测体系把它当作评测器直接调用——
 * "什么是合法状态"只有这一份定义（docs/evaluation-system.md §2.1）。
 *
 * 评测纪律：只观察，不介入控制流。
 */

export type FindingSeverity = "critical" | "warning" | "info";

export interface Finding {
  rule: string;
  severity: FindingSeverity;
  title: string;
  evidence: string;
}

export interface DiagStats {
  phase: string;
  flow: string;
  completedChapters: number;
  totalChapters: number;
  totalWords: number;
  inProgressChapter: number;
}

export interface DiagReport {
  stats: DiagStats;
  findings: Finding[];
}

const CRITICAL = "critical" as const;
const WARNING = "warning" as const;

/** Compass 允许的最大滞后章数（与 docs/observability.md §3 一致）。 */
export const COMPASS_DRIFT_THRESHOLD = 15;
/** Coordinator 会话里连续相同工具调用超过该次数视为死循环（docs/observability.md §2）。 */
export const REPEATED_TOOL_THRESHOLD = 5;

export async function diagnose(store: Store): Promise<DiagReport> {
  const progress = await store.progress.load();
  if (!progress) return { stats: emptyStats(), findings: [] };

  const findings: Finding[] = [];
  const completed = [...progress.completed_chapters].sort((a, b) => a - b);
  const latest = completed.at(-1) ?? 0;
  const checkpoints = await store.checkpoints.all();
  const commitByChapter = new Map<number, number>();

  for (const checkpoint of checkpoints) {
    if (checkpoint.scope.kind === "chapter" && checkpoint.step === "commit") {
      const chapter = checkpoint.scope.chapter ?? 0;
      commitByChapter.set(chapter, (commitByChapter.get(chapter) ?? 0) + 1);
    }
  }

  for (const chapter of completed) {
    if (!commitByChapter.has(chapter)) {
      findings.push({
        rule: "CommitWithoutCheckpoint",
        severity: CRITICAL,
        title: "已完成章节缺少 commit checkpoint",
        evidence: `第 ${chapter} 章标记为已完成，但 meta/checkpoints.jsonl 中没有 chapter:${chapter}:commit`,
      });
    }
    const text = await store.drafts.loadChapterText(chapter);
    if (!text || !text.trim()) {
      findings.push({
        rule: "MissingChapterText",
        severity: CRITICAL,
        title: "已完成章节正文缺失或为空",
        evidence: `第 ${chapter} 章已完成但 chapters/${String(chapter).padStart(2, "0")}.md 不存在或为空`,
      });
    }
    const summary = await store.summaries.loadSummary(chapter);
    if (!summary) {
      findings.push({
        rule: "MissingChapterSummary",
        severity: WARNING,
        title: "已完成章节缺少章摘要",
        evidence: `第 ${chapter} 章已完成但 summaries/${String(chapter).padStart(2, "0")}.json 不存在`,
      });
    }
  }

  for (const [chapter, count] of commitByChapter) {
    if (!completed.includes(chapter)) {
      findings.push({
        rule: "CheckpointOrphan",
        severity: WARNING,
        title: "commit checkpoint 指向未完成章节",
        evidence: `存在 chapter:${chapter}:commit 但第 ${chapter} 章不在 completed_chapters 中（回滚残留？）`,
      });
    }
    if (count > 1) {
      findings.push({
        rule: "DuplicateCommit",
        severity: WARNING,
        title: "同一章节出现多次 commit checkpoint",
        evidence: `第 ${chapter} 章有 ${count} 个 commit checkpoint（恢复后重复提交？）`,
      });
    }
  }

  for (let index = 0; index < completed.length; index += 1) {
    if (completed[index] !== index + 1) {
      findings.push({
        rule: "ChapterGaps",
        severity: WARNING,
        title: "已完成章节存在缺口",
        evidence: `completed_chapters=${JSON.stringify(completed)} 不是从 1 开始的连续前缀`,
      });
      break;
    }
  }

  const flow = progress.flow ?? "writing";
  if (flow === "steering") {
    findings.push({
      rule: "PhaseFlowMismatch",
      severity: WARNING,
      title: "运行结束后 flow 仍停在 steering",
      evidence: `phase=${progress.phase} flow=${flow}（干预应已处理并回到 writing）`,
    });
  }
  if ((flow === "rewriting" || flow === "polishing") && !(progress.pending_rewrites?.length)) {
    findings.push({
      rule: "PhaseFlowMismatch",
      severity: WARNING,
      title: "flow 停留在改写态但队列已空",
      evidence: `flow=${flow} 而 pending_rewrites 为空（flow 卡死？）`,
    });
  }
  if (progress.pending_rewrites?.length) {
    findings.push({
      rule: "PendingRewrites",
      severity: WARNING,
      title: "运行结束时仍有待重写章节",
      evidence: `pending_rewrites=${JSON.stringify(progress.pending_rewrites)}`,
    });
  }
  if ((progress.in_progress_chapter ?? 0) > 0) {
    findings.push({
      rule: "InProgressResidue",
      severity: WARNING,
      title: "运行结束时存在进行中章节残留",
      evidence: `in_progress_chapter=${progress.in_progress_chapter}（崩溃中断痕迹，恢复后应清零）`,
    });
  }
  if ((await store.signals.loadPendingCommit()) !== null) {
    findings.push({
      rule: "PendingCommitSignal",
      severity: WARNING,
      title: "meta/pending_commit.json 信号残留",
      evidence: "崩溃提交信号未清零",
    });
  }
  const runMeta = await store.runMeta.load();
  if (runMeta?.pending_steer?.trim()) {
    findings.push({
      rule: "PendingSteer",
      severity: WARNING,
      title: "停机干预意见未处理",
      evidence: `pending_steer="${runMeta.pending_steer.trim().slice(0, 40)}"`,
    });
  }

  if (progress.phase === "writing") {
    const outline = await store.outline.loadOutline();
    const next = latest + 1;
    if (outline.length && next > 0 && !outline.some((entry) => entry.chapter === next)) {
      findings.push({
        rule: "OutlineExhausted",
        severity: WARNING,
        title: "下一章没有可用大纲条目",
        evidence: `已写至第 ${latest} 章，扁平大纲中不存在第 ${next} 章条目（滚动规划未及时展开）`,
      });
    }
    if (progress.layered) {
      const compass = await store.outline.loadCompass();
      if (compass?.last_updated !== undefined && latest - compass.last_updated > COMPASS_DRIFT_THRESHOLD) {
        findings.push({
          rule: "CompassDrift",
          severity: WARNING,
          title: "指南针滞后最新章节过远",
          evidence: `last_updated=${compass.last_updated} latest=${latest}（gap=${latest - compass.last_updated} > ${COMPASS_DRIFT_THRESHOLD}）`,
        });
      }
    }
  }

  if (progress.phase === "writing" || progress.phase === "complete") {
    const missing = await store.foundationMissing();
    if (missing.length) {
      findings.push({
        rule: "MissingFoundation",
        severity: WARNING,
        title: "基础设定缺失",
        evidence: `缺失工件：${missing.join("、")}`,
      });
    }
  }

  findings.push(...(await detectRepeatedToolLoop(store)));

  return {
    stats: {
      phase: progress.phase,
      flow,
      completedChapters: completed.length,
      totalChapters: progress.total_chapters,
      totalWords: progress.total_word_count,
      inProgressChapter: progress.in_progress_chapter ?? 0,
    },
    findings,
  };
}

/** 从 coordinator 会话尾巴检测同一工具连续空调形成的死循环。 */
async function detectRepeatedToolLoop(store: Store): Promise<Finding[]> {
  const text = await new FileIO(store.dir).readText("meta/sessions/coordinator.jsonl");
  if (!text) return [];
  const lines = text.split(/\r?\n/).filter(Boolean).slice(-200);
  let lastTool = "";
  let streak = 0;
  let peak: { name: string; count: number } | null = null;
  for (const line of lines) {
    let message: { content?: Array<{ type?: string; toolCall?: { name?: string } }> };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      continue;
    }
    let name = "";
    for (const block of message.content ?? []) {
      if (block.type === "tool-call" && block.toolCall?.name) {
        name = block.toolCall.name;
        break;
      }
    }
    if (name) {
      streak = name === lastTool ? streak + 1 : 1;
      lastTool = name;
      if (streak > (peak?.count ?? 0)) peak = { name, count: streak };
    } else {
      lastTool = "";
      streak = 0;
    }
  }
  if (peak && peak.count > REPEATED_TOOL_THRESHOLD) {
    return [{
      rule: "RepeatedToolLoop",
      severity: WARNING,
      title: "coordinator 连续重复调用同一工具",
      evidence: `工具 ${peak.name} 连续调用 ${peak.count} 次（> ${REPEATED_TOOL_THRESHOLD}，疑似死循环）`,
    }];
  }
  return [];
}

function emptyStats(): DiagStats {
  return { phase: "", flow: "", completedChapters: 0, totalChapters: 0, totalWords: 0, inProgressChapter: 0 };
}
