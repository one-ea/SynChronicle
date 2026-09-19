import { z } from "zod";

/**
 * 自动驾驶流水线状态模型（specs/2026-09-19-p8-autopilot-pipeline）。
 * 用户一句话启动，AI 依次完成 前提 → 大纲 → 逐章(写作→编辑打分→有界重写→采纳)，
 * 用户仅在检查点微调。持久化为 meta/autopilot.json。
 */

export const AutopilotCheckpointSchema = z.enum(["none", "premise-outline", "chapter"]);
export type AutopilotCheckpoint = z.infer<typeof AutopilotCheckpointSchema>;

export const AutopilotSettingsSchema = z.object({
  checkpoint: AutopilotCheckpointSchema.default("premise-outline"),
  scoreThreshold: z.number().int().min(1).max(100).default(75),
  maxRewrites: z.number().int().min(0).max(5).default(2),
});
export type AutopilotSettings = z.infer<typeof AutopilotSettingsSchema>;

export const AutopilotPhaseSchema = z.enum([
  "idle",
  "premise",
  "premise-review",
  "outline",
  "outline-review",
  "chapter-review",
  "writing",
  "complete",
  "stopped",
  "error",
]);
export type AutopilotPhase = z.infer<typeof AutopilotPhaseSchema>;

export const AutopilotStateSchema = z.object({
  phase: AutopilotPhaseSchema.default("idle"),
  stage: z.enum(["idle", "premise", "outline", "writing"]).default("idle"),
  idea: z.string().default(""),
  proposal: z.string().default(""),
  currentChapter: z.number().int().nonnegative().default(0),
  totalChapters: z.number().int().nonnegative().default(0),
  rewriteCount: z.number().int().nonnegative().default(0),
  adoptedCount: z.number().int().nonnegative().default(0),
  reviewQueue: z.array(z.number().int().positive()).default([]),
  bestScore: z.number().min(0).default(0),
  lastScore: z.number().min(0).default(0),
  budgetUsd: z.number().min(0).default(0),
  costUsd: z.number().min(0).default(0),
  startedAt: z.string().default(""),
  stoppedAt: z.string().nullable().default(null),
  error: z.string().default(""),
  settings: AutopilotSettingsSchema.default(AutopilotSettingsSchema.parse({})),
});
export type AutopilotState = z.infer<typeof AutopilotStateSchema>;

export const AUTOPILOT_PATH = "meta/autopilot.json";

export function emptyAutopilotState(): AutopilotState {
  return AutopilotStateSchema.parse({});
}

/** 运行中的相位（需要 loop 驱动或等待用户动作）。 */
export function isActivePhase(phase: AutopilotPhase): boolean {
  return phase !== "idle" && phase !== "complete" && phase !== "error";
}

/** 当前所属阶段，用于 stopped 后断点续跑。 */
export function stageOfPhase(phase: AutopilotPhase): "premise" | "outline" | "writing" | null {
  if (phase.startsWith("premise")) return "premise";
  if (phase.startsWith("outline")) return "outline";
  if (phase === "writing" || phase === "chapter-review" || phase === "complete") return "writing";
  return null;
}
