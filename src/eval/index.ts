import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type Outcome = "PASS" | "WARN" | "FAIL";

export const EVAL_CATEGORIES = ["smoke", "workflow", "quality", "longform", "recovery", "steering"] as const;
export type EvalCategory = (typeof EVAL_CATEGORIES)[number];

export interface EvalSeed {
  /** 运行前把 progress.in_progress_chapter 置为该章（模拟崩溃残留）。 */
  inProgressChapter?: number;
  /** 运行前写入 meta/pending_commit.json 信号（模拟崩溃提交残留）。 */
  pendingCommit?: boolean;
  /** 第二阶段（resume）前写入 runMeta.pending_steer（模拟停机窗口干预）。 */
  pendingSteer?: string;
}

export interface EvalExpect {
  phase?: string;
  minCompletedChapters?: number;
  requiredCheckpoints?: string[];
  noPending?: string[];
  /** 至少存在 N 份章摘要（summaries/NN.json）。 */
  minChapterSummaries?: number;
  /** 至少存在 N 份弧摘要（summaries/arc-v*.json）。 */
  minArcSummaries?: number;
  /** 至少存在 N 份评审（reviews/*.json）。 */
  minReviews?: number;
  /** 恢复类 case：第一阶段跑到该值减一后中断，第二阶段 resume 并断言总完成章数 ≥ 该值。 */
  resumeToChapters?: number;
  /** 恢复/干预类 case 的预置状态。 */
  seed?: EvalSeed;
  /** 干预类 case：resume 前注入的停机干预意见。 */
  steer?: { afterChapters: number; message: string };
}

export interface EvalGate {
  maxSeverity: string;
  maxCostDeltaRatio: number;
  maxToolCallDeltaRatio: number;
  stylestatRegression: string;
}

export interface EvalCase {
  id: string;
  category: string;
  role?: string;
  description?: string;
  prompt: string;
  style?: string;
  targetPrompts?: string[];
  rubric?: string;
  maxChapters: number;
  expect: EvalExpect;
  gate: EvalGate;
}

const SEVERITIES = ["critical", "warning", "info"] as const;
const STYLESTAT_GATES = ["block", "warn", "off"] as const;

const parseCase = (raw: Record<string, unknown>): EvalCase => {
  const id = String(raw.id ?? "");
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) throw new Error(`case id 非法 ${id}`);
  if (!String(raw.prompt ?? "").trim()) throw new Error(`case ${id} 缺少 prompt`);
  const category = String(raw.category ?? "");
  if (!EVAL_CATEGORIES.includes(category as EvalCategory)) {
    throw new Error(`case ${id} 的 category ${JSON.stringify(category)} 非法（应为 ${EVAL_CATEGORIES.join("/")}）`);
  }
  const gate = (raw.gate ?? {}) as Record<string, unknown>;
  const severity = String(gate.max_severity ?? "warning");
  if (!SEVERITIES.includes(severity as (typeof SEVERITIES)[number])) throw new Error("gate.max_severity 非法");
  const stylestatRegression = String(gate.stylestat_regression ?? "warn");
  if (!STYLESTAT_GATES.includes(stylestatRegression as (typeof STYLESTAT_GATES)[number])) throw new Error("gate.stylestat_regression 非法");
  const expect = (raw.expect ?? {}) as Record<string, unknown>;
  const seed = (expect.seed ?? {}) as Record<string, unknown>;
  const steer = (expect.steer ?? {}) as Record<string, unknown>;
  const targetPrompts = Array.isArray(raw.target_prompts) ? raw.target_prompts.map(String) : undefined;
  const maxChapters = Number(raw.max_chapters ?? 0);
  if (!Number.isInteger(maxChapters) || maxChapters <= 0) throw new Error(`case ${id} 的 max_chapters 必须为正整数`);
  return {
    id,
    category,
    role: raw.role ? String(raw.role) : undefined,
    description: raw.description ? String(raw.description) : undefined,
    prompt: String(raw.prompt),
    style: raw.style ? String(raw.style) : undefined,
    targetPrompts,
    rubric: raw.rubric ? String(raw.rubric) : undefined,
    maxChapters,
    expect: {
      phase: expect.phase ? String(expect.phase) : undefined,
      minCompletedChapters: expect.min_completed_chapters ? Number(expect.min_completed_chapters) : undefined,
      requiredCheckpoints: Array.isArray(expect.required_checkpoints) ? expect.required_checkpoints.map(String) : undefined,
      noPending: Array.isArray(expect.no_pending) ? expect.no_pending.map(String) : undefined,
      minChapterSummaries: expect.min_chapter_summaries ? Number(expect.min_chapter_summaries) : undefined,
      minArcSummaries: expect.min_arc_summaries ? Number(expect.min_arc_summaries) : undefined,
      minReviews: expect.min_reviews ? Number(expect.min_reviews) : undefined,
      resumeToChapters: expect.resume_to_chapters ? Number(expect.resume_to_chapters) : undefined,
      seed: {
        inProgressChapter: seed.in_progress_chapter ? Number(seed.in_progress_chapter) : undefined,
        pendingCommit: seed.pending_commit === true,
        pendingSteer: seed.pending_steer ? String(seed.pending_steer) : undefined,
      },
      steer: steer.message
        ? { afterChapters: Number(steer.after_chapters ?? 0), message: String(steer.message) }
        : undefined,
    },
    gate: {
      maxSeverity: severity,
      maxCostDeltaRatio: Number(gate.max_cost_delta_ratio ?? 0.3),
      maxToolCallDeltaRatio: Number(gate.max_tool_call_delta_ratio ?? 0.3),
      stylestatRegression,
    },
  };
};

export function loadCases(path: string): EvalCase[] {
  const files = statSync(path).isDirectory()
    ? readdirSync(path, { recursive: true }).filter(x => String(x).endsWith(".json")).map(x => join(path, String(x)))
    : [path];
  const cases = files
    .map(file => parseCase(JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>))
    .sort((a, b) => a.id.localeCompare(b.id));
  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.id)) throw new Error(`case id 重复: ${c.id}`);
    seen.add(c.id);
    const expect = c.expect;
    if (expect.resumeToChapters !== undefined && expect.resumeToChapters < 2) throw new Error(`case ${c.id} 的 resume_to_chapters 必须 ≥ 2`);
    if (expect.steer && !expect.resumeToChapters) throw new Error(`case ${c.id} 的 steer 需要 resume_to_chapters`);
    if (expect.steer && !expect.steer.afterChapters) throw new Error(`case ${c.id} 的 steer.after_chapters 必须为正整数`);
    if (expect.seed && (expect.seed.inProgressChapter !== undefined || expect.seed.pendingCommit || expect.seed.pendingSteer)) {
      const seed = expect.seed;
      if (seed.inProgressChapter !== undefined && (!Number.isInteger(seed.inProgressChapter) || seed.inProgressChapter <= 0)) throw new Error(`case ${c.id} 的 seed.in_progress_chapter 必须为正整数`);
      if (seed.pendingSteer !== undefined && !seed.pendingSteer.trim()) throw new Error(`case ${c.id} 的 seed.pending_steer 不能为空`);
    }
    if (expect.steer) {
      if (!Number.isInteger(expect.steer.afterChapters) || expect.steer.afterChapters <= 0) throw new Error(`case ${c.id} 的 steer.after_chapters 必须为正整数`);
      if (expect.resumeToChapters !== undefined && expect.steer.afterChapters >= expect.resumeToChapters) throw new Error(`case ${c.id} 的 steer.after_chapters 必须小于 resume_to_chapters`);
    }
  }
  if (!cases.length) throw new Error(`未找到任何 case: ${path}`);
  return cases;
}

export interface GradeInput {
  dir: string;
  runtimeErr?: string;
  stats: { completedChapters: number; phase: string; [key: string]: unknown };
  findings: Array<{ rule: string; severity: string; title?: string }>;
  checkpoints: string[];
  pending: Record<string, boolean>;
  loadErrors: string[];
}

export interface GradeResult {
  caseId: string;
  category: string;
  role?: string;
  outcome: Outcome;
  hardFails: string[];
  warnings: string[];
  notes: string[];
  passed: string[];
  metrics: GradeInput["stats"];
  dir: string;
}

export function grade(c: EvalCase, col: GradeInput): GradeResult {
  const hardFails: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const passed: string[] = [];
  if (col.runtimeErr) hardFails.push(`运行时错误: ${col.runtimeErr}`);
  hardFails.push(...col.loadErrors.map(x => `工件读取失败: ${x}`));
  const rank: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  for (const f of col.findings) {
    const detail = `finding:${f.rule}`;
    if ((rank[f.severity] ?? 9) < (rank[c.gate.maxSeverity] ?? 1)) hardFails.push(detail);
    else if (f.severity === c.gate.maxSeverity) warnings.push(detail);
    else notes.push(detail);
  }
  if (c.expect.phase && col.stats.phase !== c.expect.phase) hardFails.push(`contract:phase ${col.stats.phase}`);
  if ((col.stats.completedChapters ?? 0) < (c.expect.minCompletedChapters ?? 0)) hardFails.push("contract:min_completed_chapters");
  for (const cp of c.expect.requiredCheckpoints ?? []) {
    if (col.checkpoints.includes(cp)) passed.push(cp);
    else hardFails.push(`contract:checkpoint ${cp}`);
  }
  for (const p of c.expect.noPending ?? []) {
    if (col.pending[p]) hardFails.push(`contract:no_pending ${p}`);
    else passed.push(`no_pending:${p}`);
  }
  return { caseId: c.id, category: c.category, role: c.role, outcome: (hardFails.length ? "FAIL" : warnings.length ? "WARN" : "PASS") as Outcome, hardFails, warnings, notes, passed, metrics: col.stats, dir: col.dir };
}

export function aggregate(runId: string, mode: string, variant: string, repeat: number, cases: Array<{ outcome: Outcome; [key: string]: unknown }>) {
  const gate: Outcome = cases.some(c => c.outcome === "FAIL") ? "FAIL" : cases.some(c => c.outcome === "WARN") ? "WARN" : "PASS";
  return { runId, mode, variant, repeat: repeat > 0 ? repeat : 1, gate, cases };
}
