import { readdirSync } from "node:fs";
import { join } from "node:path";
import { diagnose, type DiagReport, type Finding } from "../diag/diagnose.js";
import { compute, type StyleStats } from "../stylestat/index.js";
import { Store } from "../store/index.js";
import { FileIO } from "../store/io.js";

export interface CaseMetrics {
  completedChapters: number;
  totalChapters: number;
  totalWords: number;
  phase: string;
  flow: string;
  inProgressChapter: number;
  toolCalls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  criticalFindings: number;
  warningFindings: number;
  chapterSummaries: number;
  arcSummaries: number;
  volumeSummaries: number;
  reviews: number;
  chapterWords: Record<number, number>;
}

export interface CaseCollect {
  dir: string;
  stats: CaseMetrics;
  findings: Finding[];
  checkpoints: string[];
  pending: Record<string, boolean>;
  stylestat: StyleStats | null;
  loadErrors: string[];
}

const pad = (n: number) => String(n).padStart(2, "0");

export async function collect(dir: string): Promise<CaseCollect> {
  const store = new Store(dir);
  const loadErrors: string[] = [];

  const diag: DiagReport = await diagnose(store);
  const progress = await store.progress.load();

  const checkpointLabels: string[] = [];
  for (const checkpoint of await store.checkpoints.all()) {
    const scope = checkpoint.scope;
    if (scope.kind === "chapter") checkpointLabels.push(`chapter:${scope.chapter}:${checkpoint.step}`);
    else if (scope.kind === "arc") checkpointLabels.push(`arc:${scope.volume}:${scope.arc}:${checkpoint.step}`);
    else if (scope.kind === "volume") checkpointLabels.push(`volume:${scope.volume}:${checkpoint.step}`);
    else checkpointLabels.push(`global:${checkpoint.step}`);
  }

  let costUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  try {
    const usage = await store.usage.load();
    if (usage) {
      costUsd = usage.overall.cost_usd;
      inputTokens = usage.overall.input;
      outputTokens = usage.overall.output;
      cacheReadTokens = usage.overall.cache_read;
    }
  } catch (error) {
    loadErrors.push(`meta/usage.json: ${error instanceof Error ? error.message : String(error)}`);
  }

  let toolCalls = 0;
  try {
    const agentDir = join(dir, "meta", "sessions", "agents");
    for (const file of readdirSync(agentDir)) {
      if (!file.endsWith(".jsonl")) continue;
      const text = await new FileIO(dir).readText(join("meta", "sessions", "agents", file));
      toolCalls += countToolCalls(text);
    }
  } catch (error) {
    if (!isMissing(error)) loadErrors.push(`sessions: ${error instanceof Error ? error.message : String(error)}`);
  }

  let chapterSummaries = 0;
  let arcSummaries = 0;
  let volumeSummaries = 0;
  let reviews = 0;
  try {
    for (const file of readdirSync(join(dir, "summaries"))) {
      if (/^\d{2}\.json$/.test(file)) chapterSummaries += 1;
      else if (file.startsWith("arc-v")) arcSummaries += 1;
      else if (file.startsWith("vol-v")) volumeSummaries += 1;
    }
  } catch (error) {
    if (!isMissing(error)) loadErrors.push(`summaries: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    reviews = readdirSync(join(dir, "reviews")).filter(file => file.endsWith(".json")).length;
  } catch (error) {
    if (!isMissing(error)) loadErrors.push(`reviews: ${error instanceof Error ? error.message : String(error)}`);
  }

  const chapterWords: Record<number, number> = {};
  try {
    for (const file of readdirSync(join(dir, "chapters"))) {
      const match = /^(\d+)\.md$/.exec(file);
      if (match?.[1]) chapterWords[Number(match[1])] = await countRunes(store, Number(match[1]));
    }
  } catch (error) {
    if (!isMissing(error)) loadErrors.push(`chapters: ${error instanceof Error ? error.message : String(error)}`);
  }

  let stylestat: StyleStats | null = null;
  try {
    stylestat = await computeStyleStats(store);
  } catch (error) {
    loadErrors.push(`stylestat: ${error instanceof Error ? error.message : String(error)}`);
  }

  const pending: Record<string, boolean> = {
    in_progress: (diag.stats.inProgressChapter ?? 0) > 0,
    pending_commit: (await store.signals.loadPendingCommit()) !== null,
    pending_rewrites: (progress?.pending_rewrites?.length ?? 0) > 0,
    pending_steer: Boolean((await store.runMeta.load())?.pending_steer?.trim()),
  };

  return {
    dir,
    stats: {
      completedChapters: diag.stats.completedChapters,
      totalChapters: diag.stats.totalChapters,
      totalWords: diag.stats.totalWords,
      phase: diag.stats.phase,
      flow: diag.stats.flow,
      inProgressChapter: diag.stats.inProgressChapter,
      toolCalls,
      costUsd,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      criticalFindings: diag.findings.filter(f => f.severity === "critical").length,
      warningFindings: diag.findings.filter(f => f.severity === "warning").length,
      chapterSummaries,
      arcSummaries,
      volumeSummaries,
      reviews,
      chapterWords,
    },
    findings: diag.findings,
    checkpoints: checkpointLabels,
    pending,
    stylestat,
    loadErrors,
  };
}

async function countRunes(store: Store, chapter: number): Promise<number> {
  const text = await store.drafts.loadChapterText(chapter);
  return text ? [...text.replace(/\s/g, "")].length : 0;
}

async function computeStyleStats(store: Store): Promise<StyleStats | null> {
  let files: string[];
  try {
    files = readdirSync(join(store.dir, "chapters")).filter(file => /^\d+\.md$/.test(file)).sort((a, b) => Number(a) - Number(b));
  } catch {
    return null;
  }
  if (files.length < 5) return null;
  const texts: string[] = [];
  for (const file of files) texts.push(await store.drafts.loadChapterText(Number(file)));
  const titles: string[] = [];
  const outline = await store.outline.loadOutline();
  for (const file of files) {
    const chapter = Number(file);
    const entry = outline.find(e => e.chapter === chapter);
    titles.push(entry?.title ?? "");
  }
  return compute({ chapters: texts, titles, stopwords: [] });
}

function countToolCalls(text: string): number {
  let count = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const message = JSON.parse(line) as { content?: Array<{ type?: string }> };
      for (const block of message.content ?? []) {
        if (block.type === "tool-call") count += 1;
      }
    } catch {
      // 容忍单行损坏
    }
  }
  return count;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

export { pad };
