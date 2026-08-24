import { readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig, type Config } from "../config/index.js";
import { loadAssets, overridePrompt, type AssetBundle } from "../assets/load.js";
import { Host } from "../runtime/host.js";
import { Store } from "../store/index.js";
import { createModelSet } from "../providers/index.js";
import { loadCases, grade, type EvalCase, type Outcome } from "./index.js";
import { collect, type CaseCollect, type CaseMetrics } from "./collect.js";
import { computeDeltas, type CaseDeltas } from "./deltas.js";
import { Judge, loadRubric, type JudgeRun } from "./judge.js";
import { buildReport, type CaseReport, type RunReport } from "./report.js";
import type { RuntimeEvent } from "../domain/index.js";

export interface EvalOptions {
  cases: string;
  variant: string;
  config: string;
  out: string;
  maxChapters: number;
  timeout: string;
  repeat: number;
  ci: boolean;
  judge: boolean | null;
}

export interface EvalHost {
  store: { dir: string };
  startPrepared(prompt: string): Promise<void>;
  resume(): Promise<{ label: string | null; error?: Error }>;
  abort(reason: string): void;
  events(): AsyncIterable<RuntimeEvent>;
  stream(): AsyncIterable<string>;
  close(): Promise<void>;
}

export interface RunDeps {
  hostFactory?: (cfg: Config, bundle: AssetBundle) => Promise<EvalHost>;
  stderr?: (text: string) => void;
  now?: () => Date;
}

const DEFAULT_RUBRICS_DIR = "evals/rubrics";

export class EvalTimeoutError extends Error {
  constructor(ms: number) {
    super(`eval: 单 case 超时（${ms}ms）`);
    this.name = "EvalTimeoutError";
  }
}

/** 解析 "30m" / "90s" / "1h" / "500ms" / 裸数字（秒）。非法值抛错。 */
export function parseTimeout(value: string): number {
  const match = /^(\d+)(ms|s|m|h)?$/.exec(value.trim());
  if (!match) throw new Error(`timeout 非法: ${value}（支持如 30m / 90s / 1h）`);
  const amount = Number(match[1]);
  const unit = match[2] ?? "s";
  const factor = unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000;
  return amount * factor;
}

export async function runEval(options: EvalOptions, deps: RunDeps = {}): Promise<number> {
  const write = deps.stderr ?? ((text) => process.stderr.write(text));
  const now = deps.now ?? (() => new Date());
  const runId = formatRunId(now());
  const outDir = options.out || join("eval-out", runId);

  const config = await loadConfig(options.config || undefined);
  const baseBundle = loadAssets(config.style);
  const cases = loadCases(options.cases);
  const mode: "single" | "ab" = options.variant ? "ab" : "single";
  const judgeEnabled = options.judge === true ? true : options.judge === false ? false : mode === "ab" && cases.some(c => c.rubric);
  if (options.judge === true && mode !== "ab") throw new Error("--judge 需要 --variant（Judge 只做 baseline/variant 比较）");
  if (mode === "ab" && !statSync(options.variant).isDirectory()) throw new Error(`variant 目录不存在: ${options.variant}`);

  await mkdir(outDir, { recursive: true });
  const timeoutMs = parseTimeout(options.timeout);

  const caseReports: CaseReport[] = [];
  let judgeFailures = 0;
  let judgeCount = 0;

  for (const c of cases) {
    const cap = options.maxChapters > 0 ? options.maxChapters : c.maxChapters;
    for (let repeatIndex = 1; repeatIndex <= options.repeat; repeatIndex += 1) {
      const labelDir = options.repeat > 1 ? `r${repeatIndex}` : "";
      const baseDir = join(outDir, "artifacts", c.id, labelDir, "baseline");
      const variantDir = join(outDir, "artifacts", c.id, labelDir, "variant");

      const bundle = c.style && c.style !== config.style ? loadAssets(c.style) : baseBundle;
      const baseCollect = await tryRunCase(c, config, bundle, { dir: baseDir, cap, timeoutMs, deps }, caseReports);
      if (baseCollect === null) continue;

      let variantCollect: CaseCollect | null = null;
      if (mode === "ab") {
        const variantBundle = applyVariant(bundle, options.variant, c);
        variantCollect = await tryRunCase(c, config, variantBundle, { dir: variantDir, cap, timeoutMs, deps }, caseReports);
        if (variantCollect === null) continue;
      }

      const deltas: CaseDeltas | null = variantCollect ? computeDeltas(c.gate, baseCollect, variantCollect) : null;

      let judge: JudgeRun | null = null;
      if (mode === "ab" && judgeEnabled && c.rubric) {
        judgeCount += 1;
        judge = await runJudge(c, config, baseCollect, variantCollect!);
        if (judge && !judge.ok) judgeFailures += 1;
      }

      const baseGrade = grade(c, toGradeInput(baseCollect));
      const variantGrade = variantCollect ? grade(c, toGradeInput(variantCollect)) : null;

      const hardFails = [...baseGrade.hardFails, ...(variantGrade?.hardFails ?? []), ...(deltas?.hardFails ?? [])];
      const warnings = [...baseGrade.warnings, ...(variantGrade?.warnings ?? []), ...(deltas?.warnings ?? [])];
      const notes = [...baseGrade.notes, ...(variantGrade?.notes ?? []), ...(deltas?.notes ?? [])];
      const outcome: Outcome = hardFails.length ? "FAIL" : warnings.length ? "WARN" : "PASS";

      caseReports.push({
        caseId: c.id,
        category: c.category,
        role: c.role,
        description: c.description,
        mode,
        outcome,
        hardFails,
        warnings,
        notes,
        passed: [...baseGrade.passed, ...(variantGrade?.passed ?? [])],
        base: { dir: baseDir, metrics: baseCollect.stats, stylestat: baseCollect.stylestat, findings: baseCollect.findings, checkpoints: baseCollect.checkpoints },
        ...(variantCollect ? { variant: { dir: variantDir, metrics: variantCollect.stats, stylestat: variantCollect.stylestat, findings: variantCollect.findings, checkpoints: variantCollect.checkpoints } } : {}),
        ...(deltas ? { deltas } : {}),
        ...(judge ? { judge } : {}),
      });

      if (options.ci) {
        write(`eval: ${c.id} r${repeatIndex} ${outcome}${hardFails.length ? ` (${hardFails.join("; ")})` : ""}\n`);
      }
    }
  }

  const gate: Outcome = caseReports.some(c => c.outcome === "FAIL") ? "FAIL" : caseReports.some(c => c.outcome === "WARN") ? "WARN" : "PASS";
  const report: RunReport = {
    runId,
    generatedAt: now().toISOString(),
    mode,
    variant: options.variant,
    repeat: options.repeat,
    judgeEnabled,
    judgeCount,
    judgeFailures,
    gate,
    cases: caseReports,
  };
  const rendered = buildReport(report);
  await writeFile(join(outDir, "report.json"), `${JSON.stringify(rendered.json, null, 2)}\n`, "utf8");
  await writeFile(join(outDir, "report.md"), rendered.md, "utf8");
  write(`eval: ${runId} gate=${gate}（PASS ${caseReports.filter(c => c.outcome === "PASS").length} / WARN ${caseReports.filter(c => c.outcome === "WARN").length} / FAIL ${caseReports.filter(c => c.outcome === "FAIL").length}）→ ${join(outDir, "report.md")}\n`);
  return gate === "FAIL" ? 1 : 0;
}

interface RunCaseOptions {
  dir: string;
  cap: number;
  timeoutMs: number;
  deps: RunDeps;
}

/**
 * 运行 case；任何运行期错误（含超时）都推入一个 FAIL CaseReport 并返回 null——
 * 失败本身就是评测结果（docs §2.6），绝不静默跳过。
 */
async function tryRunCase(c: EvalCase, config: Config, bundle: AssetBundle, opts: RunCaseOptions, caseReports: CaseReport[]): Promise<CaseCollect | null> {
  try {
    return await runCase(c, config, bundle, opts);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    caseReports.push({
      caseId: c.id,
      category: c.category,
      role: c.role,
      description: c.description,
      mode: "single",
      outcome: "FAIL",
      hardFails: [`运行时错误: ${message}`],
      warnings: [],
      notes: [],
      passed: [],
      base: { dir: opts.dir, metrics: emptyMetrics(), stylestat: null, findings: [], checkpoints: [] },
    });
    return null;
  }
}

function emptyMetrics(): CaseMetrics {
  return {
    completedChapters: 0, totalChapters: 0, totalWords: 0, phase: "", flow: "",
    inProgressChapter: 0, toolCalls: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
    criticalFindings: 0, warningFindings: 0, chapterSummaries: 0, arcSummaries: 0, volumeSummaries: 0, reviews: 0, chapterWords: {},
  };
}

/** 运行单个 case：单阶段；或恢复两阶段（截停 → 注入 seed/steer → resume）。 */
async function runCase(c: EvalCase, config: Config, bundle: AssetBundle, opts: RunCaseOptions): Promise<CaseCollect> {
  const runConfig = { ...config, output_dir: opts.dir };
  const store = new Store(opts.dir);
  await store.init();

  const expect = c.expect;
  const recovery = expect.resumeToChapters !== undefined;
  const phase1Cap = recovery
    ? expect.steer ? expect.steer.afterChapters : expect.resumeToChapters! - 1
    : opts.cap;

  const seed = expect.seed ?? {};
  if (seed.inProgressChapter) {
    await store.progress.save({
      novel_name: "",
      phase: "writing",
      current_chapter: seed.inProgressChapter,
      total_chapters: 0,
      completed_chapters: [],
      total_word_count: 0,
      in_progress_chapter: seed.inProgressChapter,
    });
  }
  if (seed.pendingCommit) await store.signals.savePendingCommit({ seeded: true });

  const factory = opts.deps.hostFactory ?? ((cfg: Config, assets: AssetBundle) => Host.new(cfg, assets, {}));
  const host = await factory(runConfig, bundle);

  try {
    if (phase1Cap > 0) {
      await runPhase(host, phase1Cap, opts.timeoutMs, () => host.startPrepared(c.prompt), opts.dir);
    }
    if (recovery) {
      const steerMessage = expect.steer?.message ?? seed.pendingSteer;
      if (steerMessage) {
        await store.runMeta.save({
          started_at: new Date().toISOString(),
          provider: config.provider,
          model: config.model,
          style: config.style ?? "default",
          planning_tier: "mid",
          steer_history: [],
          pending_steer: steerMessage,
          pause_point: null,
        });
      }
      await runPhase(host, opts.cap, opts.timeoutMs, async () => {
        const result = await host.resume();
        if (result.error) throw result.error;
        if (!result.label) throw new Error(`eval: ${c.id} resume 无可恢复会话`);
      }, opts.dir);
    }
  } finally {
    await host.close();
  }
  return collect(opts.dir);
}

/** 消费事件流并监控章数上限：completed >= cap 即截停（截停视为正常结束）；超时同样截停并抛 EvalTimeoutError。 */
async function runPhase(host: EvalHost, cap: number, timeoutMs: number, start: () => Promise<void>, dir: string): Promise<void> {
  const capReached = { value: false };
  let timedOut = false;
  let checking = false;
  const checkCap = async () => {
    if (checking || capReached.value) return;
    checking = true;
    try {
      const progress = await new Store(dir).progress.load();
      if (progress && progress.completed_chapters.length >= cap) {
        capReached.value = true;
        host.abort(`eval: 达到章节上限 ${cap}`);
      }
    } catch {
      // 进度读取失败不阻断评测；最终 collect 会报告工件问题。
    } finally {
      checking = false;
    }
  };
  const poll = setInterval(() => { void checkCap(); }, 50);
  const drain = (async () => {
    for await (const _chunk of host.stream()) {
      // 丢弃生成流，正文以落盘工件为准
    }
  })();
  const timer = setTimeout(() => {
    timedOut = true;
    host.abort(`eval: 单 case 超时（${timeoutMs}ms）`);
  }, timeoutMs);
  try {
    await start();
  } catch (error) {
    if (capReached.value) return;
    if (timedOut) throw new EvalTimeoutError(timeoutMs);
    throw error;
  } finally {
    clearInterval(poll);
    clearTimeout(timer);
    await drain;
  }
}

/** 内存覆盖 prompts 构造 variant bundle（零拷贝零重编译，docs §4）。 */
function applyVariant(bundle: AssetBundle, variantDir: string, c: EvalCase): AssetBundle {
  const clone: AssetBundle = { prompts: { ...bundle.prompts }, references: { ...bundle.references }, styles: { ...bundle.styles } };
  const files = readdirSync(variantDir).filter(file => file.endsWith(".md"));
  if (!files.length) throw new Error(`variant 目录为空: ${variantDir}`);
  for (const file of files) {
    if (c.targetPrompts && !c.targetPrompts.includes(file)) continue;
    overridePrompt(clone, file, readFileSync(join(variantDir, file), "utf8"));
  }
  return clone;
}

async function runJudge(c: EvalCase, config: Config, base: CaseCollect, variant: CaseCollect): Promise<JudgeRun | null> {
  try {
    const rubric = loadRubric(join(DEFAULT_RUBRICS_DIR, `${c.rubric}.json`));
    const baseStore = new Store(base.dir);
    const variantStore = new Store(variant.dir);
    const baseProgress = await baseStore.progress.load();
    const variantProgress = await variantStore.progress.load();
    const baseCompleted = baseProgress?.completed_chapters ?? [];
    const variantCompleted = variantProgress?.completed_chapters ?? [];
    const chapter = baseCompleted.filter(value => variantCompleted.includes(value)).at(-1);
    if (!chapter) return { ok: false, error: "baseline 与 variant 无共同已完成章节，Judge 跳过" };
    const baselineText = await baseStore.drafts.loadChapterText(chapter);
    const variantText = await variantStore.drafts.loadChapterText(chapter);
    if (!baselineText?.trim() || !variantText?.trim()) return { ok: false, error: `第 ${chapter} 章正文缺失，Judge 跳过` };
    const plan = await baseStore.drafts.loadChapterPlan(chapter);
    const summaries: string[] = [];
    for (let previous = chapter - 1; previous >= Math.max(1, chapter - 2); previous -= 1) {
      const summary = await baseStore.summaries.loadSummary(previous);
      if (summary) summaries.push(`第 ${previous} 章：${summary.summary}`);
    }
    const model = createModelSet(config).forRole("judge");
    return await new Judge({ model }).judge({
      caseId: c.id,
      prompt: c.prompt,
      chapter,
      rubric,
      plan: plan ? JSON.stringify(plan).slice(0, 800) : undefined,
      summaries: summaries.length ? summaries.join("\n") : undefined,
      stylestat: base.stylestat
        ? JSON.stringify({ patterns: base.stylestat.patterns, ending: base.stylestat.ending, openingTimeRate: base.stylestat.openingTimeRate }).slice(0, 800)
        : undefined,
      baselineText,
      variantText,
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function toGradeInput(collect: CaseCollect) {
  return {
    dir: collect.dir,
    stats: collect.stats as unknown as { completedChapters: number; phase: string; [key: string]: unknown },
    findings: collect.findings,
    checkpoints: collect.checkpoints,
    pending: collect.pending,
    loadErrors: collect.loadErrors,
  };
}

function formatRunId(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export { DEFAULT_RUBRICS_DIR };
