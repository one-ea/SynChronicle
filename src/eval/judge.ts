import { readFileSync } from "node:fs";
import { generateText, type LanguageModel } from "ai";
import { z } from "zod";

/**
 * Phase 3 LLM Judge：用版本化七维 rubric 离线做 baseline/variant 章节质量比较。
 * 约束（docs/evaluation-system.md §8）：
 * - 维度严格等于七项：consistency/character/pacing/continuity/foreshadow/hook/aesthetic；
 * - Judge 失败（非法 JSON / 生成异常）→ 记录失败，绝不污染确定性门禁；
 * - 输入控制大小：只取同一章正文 + 该章契约 + 最近摘要 + stylestat 切片。
 */

export const JUDGE_DIMENSIONS = ["consistency", "character", "pacing", "continuity", "foreshadow", "hook", "aesthetic"] as const;
export type JudgeDimension = (typeof JUDGE_DIMENSIONS)[number];

export interface JudgeRubricDimension {
  name: JudgeDimension;
  weight: number;
  criteria: string;
}

export interface JudgeRubric {
  version: number;
  name: string;
  role: string;
  updatedAt: string;
  dimensions: JudgeRubricDimension[];
}

export const JudgeOutputSchema = z.object({
  scores: z.object({
    consistency: z.number().int().min(0).max(10),
    character: z.number().int().min(0).max(10),
    pacing: z.number().int().min(0).max(10),
    continuity: z.number().int().min(0).max(10),
    foreshadow: z.number().int().min(0).max(10),
    hook: z.number().int().min(0).max(10),
    aesthetic: z.number().int().min(0).max(10),
  }),
  winner: z.enum(["baseline", "variant", "tie"]),
  confidence: z.enum(["low", "medium", "high"]),
  reasons: z.array(z.string()).max(5),
  risks: z.array(z.string()).max(5),
}).strict();
export type JudgeOutput = z.infer<typeof JudgeOutputSchema>;

export interface JudgeInput {
  caseId: string;
  prompt: string;
  chapter: number;
  rubric: JudgeRubric;
  /** 该章写作契约（drafts/NN.plan.json 摘要），可为空。 */
  plan?: string;
  /** 最近 1-2 章摘要拼接，可为空。 */
  summaries?: string;
  /** stylestat 切片（句式章均、章末短句占比等事实），可为空。 */
  stylestat?: string;
  baselineText: string;
  variantText: string;
}

export interface JudgeResult extends JudgeOutput {
  rubricName: string;
  rubricVersion: number;
  chapter: number;
}

export interface JudgeRun {
  ok: boolean;
  result?: JudgeResult;
  error?: string;
}

type LanguageModelInstance = Exclude<LanguageModel, string>;
type Generate = typeof generateText;

export interface JudgeOptions {
  model: LanguageModelInstance;
  generate?: Generate;
  retryLimit?: number;
}

export class Judge {
  private readonly model: LanguageModelInstance;
  private readonly generate: Generate;
  private readonly retryLimit: number;

  constructor({ model, generate = generateText, retryLimit = 2 }: JudgeOptions) {
    if (!Number.isInteger(retryLimit) || retryLimit < 0 || retryLimit > 3) {
      throw new RangeError("retryLimit must be an integer between 0 and 3");
    }
    this.model = model;
    this.generate = generate;
    this.retryLimit = retryLimit;
  }

  /** 返回 JudgeRun 而非抛错：任何失败都以 { ok: false, error } 形式进入报告。 */
  async judge(input: JudgeInput, signal?: AbortSignal): Promise<JudgeRun> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retryLimit; attempt += 1) {
      signal?.throwIfAborted();
      try {
        const raw = await this.generate({
          model: this.model,
          prompt: buildJudgePrompt(input),
          ...(signal ? { abortSignal: signal } : {}),
        });
        const parsed = JudgeOutputSchema.parse(JSON.parse(raw.text));
        return {
          ok: true,
          result: {
            ...parsed,
            rubricName: input.rubric.name,
            rubricVersion: input.rubric.version,
            chapter: input.chapter,
          },
        };
      } catch (error) {
        lastError = error;
      }
    }
    return { ok: false, error: `judge failed after ${this.retryLimit + 1} attempts: ${errorMessage(lastError)}` };
  }
}

export function loadRubric(path: string): JudgeRubric {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`rubric 读取失败 ${path}: ${errorMessage(error)}`);
  }
  const value = raw as Record<string, unknown>;
  const version = Number(value.version ?? 0);
  if (!Number.isInteger(version) || version <= 0) throw new Error(`rubric ${path} 缺少合法 version`);
  const name = String(value.name ?? "");
  if (!name) throw new Error(`rubric ${path} 缺少 name`);
  const role = String(value.role ?? "");
  const dimensions = Array.isArray(value.dimensions) ? value.dimensions : [];
  const parsed: JudgeRubricDimension[] = [];
  let weightSum = 0;
  for (const item of dimensions) {
    const dimension = String((item as Record<string, unknown>).name ?? "");
    if (!JUDGE_DIMENSIONS.includes(dimension as JudgeDimension)) {
      throw new Error(`rubric ${path} 维度 ${dimension} 非法（必须 ∈ ${JUDGE_DIMENSIONS.join("/")}）`);
    }
    if (parsed.some(existing => existing.name === dimension)) throw new Error(`rubric ${path} 维度重复: ${dimension}`);
    const weight = Number((item as Record<string, unknown>).weight ?? 0);
    const criteria = String((item as Record<string, unknown>).criteria ?? "");
    if (!criteria) throw new Error(`rubric ${path} 维度 ${dimension} 缺少 criteria`);
    weightSum += weight;
    parsed.push({ name: dimension as JudgeDimension, weight, criteria });
  }
  if (parsed.length !== JUDGE_DIMENSIONS.length) {
    throw new Error(`rubric ${path} 必须包含全部 ${JUDGE_DIMENSIONS.length} 个维度（当前 ${parsed.length} 个）`);
  }
  if (Math.abs(weightSum - 100) > 0.001) throw new Error(`rubric ${path} 权重之和必须为 100（当前 ${weightSum}）`);
  return {
    version,
    name,
    role,
    updatedAt: String(value.updated_at ?? ""),
    dimensions: parsed,
  };
}

export function buildJudgePrompt(input: JudgeInput): string {
  const rubricBlock = input.rubric.dimensions
    .map(dimension => `- ${dimension.name}（权重 ${dimension.weight}）：${dimension.criteria}`)
    .join("\n");
  const clip = (text: string, max = 4000) => (text.length > max ? `${text.slice(0, max)}\n…（已截断）` : text);
  return [
    "你是离线章节质量评审员。对 baseline 与 variant 的同一章正文做七维比较，只输出符合评分 schema 的 JSON。",
    `评测对象：case ${input.caseId}，第 ${input.chapter} 章。`,
    `用户原始需求：${input.prompt}`,
    `该章写作契约：${input.plan ?? "（无）"}`,
    `最近章节摘要：${input.summaries ?? "（无）"}`,
    `全书文体统计切片：${input.stylestat ?? "（无）"}`,
    "Rubric（固定标尺，维度不可增删）：",
    rubricBlock,
    "评分规则：每维 0-10 分；winner ∈ baseline/variant/tie；confidence ∈ low/medium/high；reasons/risks 每条不超过 80 字，引用原文要短。",
    `=== baseline 第 ${input.chapter} 章 ===`,
    clip(input.baselineText),
    `=== variant 第 ${input.chapter} 章 ===`,
    clip(input.variantText),
  ].join("\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
