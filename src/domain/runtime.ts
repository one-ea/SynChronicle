import { z } from "zod";

export const Phase = z.enum(["init", "premise", "outline", "writing", "complete"]);
export type Phase = z.infer<typeof Phase>;

export const FlowState = z.enum(["writing", "reviewing", "rewriting", "polishing", "steering"]);
export type FlowState = z.infer<typeof FlowState>;

export const PlanningTier = z.enum(["short", "mid", "long"]);
export type PlanningTier = z.infer<typeof PlanningTier>;

export interface Progress {
  NovelName: string;
  Phase: Phase;
  CurrentChapter: number;
  TotalChapters: number;
  CompletedChapters: number[];
  TotalWordCount: number;
  ChapterWordCounts: Record<number, number>;
  InProgressChapter: number;
  CompletedScenes: number[];
  Flow: FlowState;
  PendingRewrites: number[];
  RewriteReason: string;
  StrandHistory: string[];
  HookHistory: string[];
  CurrentVolume: number;
  CurrentArc: number;
  Layered: boolean;
  ReopenedFromComplete: boolean;
}

export const ProgressSchema = z.object({
  NovelName: z.string(),
  Phase: Phase,
  CurrentChapter: z.number().int().nonnegative(),
  TotalChapters: z.number().int().nonnegative(),
  CompletedChapters: z.array(z.number().int().positive()),
  TotalWordCount: z.number().int().nonnegative(),
  ChapterWordCounts: z.record(z.string(), z.number().int().nonnegative()),
  InProgressChapter: z.number().int().nonnegative(),
  CompletedScenes: z.array(z.number().int().positive()),
  Flow: FlowState,
  PendingRewrites: z.array(z.number().int().positive()),
  RewriteReason: z.string(),
  StrandHistory: z.array(z.string()),
  HookHistory: z.array(z.string()),
  CurrentVolume: z.number().int().nonnegative(),
  CurrentArc: z.number().int().nonnegative(),
  Layered: z.boolean(),
  ReopenedFromComplete: z.boolean(),
});

export interface ContextProfile {
  SummaryWindow: number;
  TimelineWindow: number;
  Layered: boolean;
}

export const ContextProfileSchema = z.object({
  SummaryWindow: z.number().int().nonnegative(),
  TimelineWindow: z.number().int().nonnegative(),
  Layered: z.boolean(),
});

export interface MemoryPolicy {
  Mode: string;
  SummaryWindow: number;
  TimelineWindow: number;
  LayeredSummaries: boolean;
  SummaryStrategy: string;
  WorkingRefresh: string;
  EpisodicRefresh: string;
  PlanningRefresh: string;
  FoundationRefresh: string;
  PlanningFocus: string;
  FoundationFocus: string;
  PreviousTailChars: number;
  ChapterPlanEnabled: boolean;
  RelatedLookup: boolean;
  CurrentOutlineBound: boolean;
  TotalChapters: number;
  HandoffPreferred: boolean;
  ReadOnlyThreshold: number;
}

export const MemoryPolicySchema = z.object({
  Mode: z.string(),
  SummaryWindow: z.number().int().nonnegative(),
  TimelineWindow: z.number().int().nonnegative(),
  LayeredSummaries: z.boolean(),
  SummaryStrategy: z.string(),
  WorkingRefresh: z.string(),
  EpisodicRefresh: z.string(),
  PlanningRefresh: z.string(),
  FoundationRefresh: z.string(),
  PlanningFocus: z.string(),
  FoundationFocus: z.string(),
  PreviousTailChars: z.number().int().nonnegative(),
  ChapterPlanEnabled: z.boolean(),
  RelatedLookup: z.boolean(),
  CurrentOutlineBound: z.boolean(),
  TotalChapters: z.number().int().nonnegative(),
  HandoffPreferred: z.boolean(),
  ReadOnlyThreshold: z.number().int().nonnegative(),
});

export interface SteerEntry {
  Input: string;
  Timestamp: string;
}

export const SteerEntrySchema = z.object({
  Input: z.string(),
  Timestamp: z.string(),
});

export interface PausePoint {
  After: string;
  Reason: string;
  SetAt: string;
}

export const PausePointSchema = z.object({
  After: z.string(),
  Reason: z.string(),
  SetAt: z.string(),
});

export interface RunMeta {
  StartedAt: string;
  Provider: string;
  Style: string;
  Model: string;
  PlanningTier: PlanningTier;
  SteerHistory: SteerEntry[];
  PendingSteer: string;
  PausePoint: PausePoint | null;
}

export const RunMetaSchema = z.object({
  StartedAt: z.string(),
  Provider: z.string(),
  Style: z.string(),
  Model: z.string(),
  PlanningTier: PlanningTier,
  SteerHistory: z.array(SteerEntrySchema),
  PendingSteer: z.string(),
  PausePoint: PausePointSchema.nullable(),
});