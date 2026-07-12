import { z } from "zod";

export const Phase = z.enum(["init", "premise", "outline", "writing", "complete"]);
export type Phase = z.infer<typeof Phase>;
export const FlowState = z.enum(["writing", "reviewing", "rewriting", "polishing", "steering"]);
export type FlowState = z.infer<typeof FlowState>;
export const PlanningTier = z.enum(["short", "mid", "long"]);
export type PlanningTier = z.infer<typeof PlanningTier>;
export const WindBackReason = z.enum(["review", "rewrite", "polish", "steer"]);
export type WindBackReason = z.infer<typeof WindBackReason>;
export const DraftTier = z.enum(["chapter", "scene"]);
export type DraftTier = z.infer<typeof DraftTier>;
export const Transport = z.enum(["headless", "tui"]);
export type Transport = z.infer<typeof Transport>;

export const ProgressSchema = z.object({
  novel_name: z.string(), phase: Phase, current_chapter: z.number().int().nonnegative(),
  total_chapters: z.number().int().nonnegative(), completed_chapters: z.array(z.number().int().positive()),
  total_word_count: z.number().int().nonnegative(), chapter_word_counts: z.record(z.string(), z.number().int().nonnegative()).optional(),
  in_progress_chapter: z.number().int().nonnegative().optional(), completed_scenes: z.array(z.number().int().positive()).optional(),
  flow: FlowState.optional(), pending_rewrites: z.array(z.number().int().positive()).optional(), rewrite_reason: z.string().optional(),
  strand_history: z.array(z.string()).optional(), hook_history: z.array(z.string()).optional(), current_volume: z.number().int().nonnegative().optional(),
  current_arc: z.number().int().nonnegative().optional(), layered: z.boolean().optional(), reopened_from_complete: z.boolean().optional(),
}).strict();
export type Progress = z.infer<typeof ProgressSchema>;

export const ContextProfileSchema = z.object({ summary_window: z.number().int().nonnegative(), timeline_window: z.number().int().nonnegative(), layered: z.boolean() }).strict();
export type ContextProfile = z.infer<typeof ContextProfileSchema>;
export const MemoryPolicySchema = z.object({
  mode: z.string().optional(), summary_window: z.number().int().nonnegative().optional(), timeline_window: z.number().int().nonnegative().optional(),
  layered_summaries: z.boolean().optional(), summary_strategy: z.string().optional(), working_refresh: z.string().optional(), episodic_refresh: z.string().optional(),
  planning_refresh: z.string().optional(), foundation_refresh: z.string().optional(), planning_focus: z.string().optional(), foundation_focus: z.string().optional(),
  previous_tail_chars: z.number().int().nonnegative().optional(), chapter_plan_enabled: z.boolean().optional(), related_chapter_lookup: z.boolean().optional(),
  current_outline_bound: z.boolean().optional(), total_chapters: z.number().int().nonnegative().optional(), handoff_preferred: z.boolean().optional(),
  read_only_threshold: z.number().int().nonnegative().optional(),
}).strict();
export type MemoryPolicy = z.infer<typeof MemoryPolicySchema>;
export const SteerEntrySchema = z.object({ input: z.string(), timestamp: z.string() }).strict();
export type SteerEntry = z.infer<typeof SteerEntrySchema>;
export const PausePointSchema = z.object({ after: z.string(), reason: z.string(), set_at: z.string() }).strict();
export type PausePoint = z.infer<typeof PausePointSchema>;
export const RunMetaSchema = z.object({ started_at: z.string(), provider: z.string(), style: z.string(), model: z.string(), planning_tier: PlanningTier, steer_history: z.array(SteerEntrySchema), pending_steer: z.string(), pause_point: PausePointSchema.nullable() }).strict();
export type RunMeta = z.infer<typeof RunMetaSchema>;
export const TurnMetaSchema = z.object({ turn: z.number().int().nonnegative(), agent: z.string().optional() }).strict();
export type TurnMeta = z.infer<typeof TurnMetaSchema>;
export const StrandPlanSchema = z.object({ dominant_strand: z.string(), supporting_strands: z.array(z.string()).optional() }).strict();
export type StrandPlan = z.infer<typeof StrandPlanSchema>;
export const WindBackSchema = z.object({ reason: WindBackReason, chapter: z.number().int().positive().optional() }).strict();
export type WindBack = z.infer<typeof WindBackSchema>;
