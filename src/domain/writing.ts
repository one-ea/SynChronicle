import { z } from "zod";

export interface ChapterPlan {
  Chapter: number;
  Title: string;
  Goal: string;
  Conflict: string;
  Hook: string;
  EmotionArc: string;
  Notes: string;
  Contract: ChapterContract;
}

export const ChapterPlanSchema: z.ZodType<ChapterPlan> = z.object({
  Chapter: z.number().int().positive(),
  Title: z.string(),
  Goal: z.string(),
  Conflict: z.string(),
  Hook: z.string(),
  EmotionArc: z.string(),
  Notes: z.string(),
  Contract: z.lazy(() => ChapterContractSchema),
});

export interface ChapterContract {
  RequiredBeats: string[];
  ForbiddenMoves: string[];
  ContinuityChecks: string[];
  EvaluationFocus: string[];
  EmotionTarget: string;
  PayoffPoints: string[];
  HookGoal: string;
}

export const ChapterContractSchema = z.object({
  RequiredBeats: z.array(z.string()),
  ForbiddenMoves: z.array(z.string()),
  ContinuityChecks: z.array(z.string()),
  EvaluationFocus: z.array(z.string()),
  EmotionTarget: z.string(),
  PayoffPoints: z.array(z.string()),
  HookGoal: z.string(),
});

export interface ChapterSummary {
  Chapter: number;
  Summary: string;
  Characters: string[];
  KeyEvents: string[];
}

export const ChapterSummarySchema = z.object({
  Chapter: z.number().int().positive(),
  Summary: z.string(),
  Characters: z.array(z.string()),
  KeyEvents: z.array(z.string()),
});

export interface ArcSummary {
  Volume: number;
  Arc: number;
  Title: string;
  Summary: string;
  KeyEvents: string[];
}

export const ArcSummarySchema = z.object({
  Volume: z.number().int().positive(),
  Arc: z.number().int().positive(),
  Title: z.string(),
  Summary: z.string(),
  KeyEvents: z.array(z.string()),
});

export interface VolumeSummary {
  Volume: number;
  Title: string;
  Summary: string;
  KeyEvents: string[];
}

export const VolumeSummarySchema = z.object({
  Volume: z.number().int().positive(),
  Title: z.string(),
  Summary: z.string(),
  KeyEvents: z.array(z.string()),
});

export interface CharacterSnapshot {
  Volume: number;
  Arc: number;
  Name: string;
  Status: string;
  Power: string;
  Motivation: string;
  Relations: string;
}

export const CharacterSnapshotSchema = z.object({
  Volume: z.number().int().nonnegative(),
  Arc: z.number().int().nonnegative(),
  Name: z.string(),
  Status: z.string(),
  Power: z.string(),
  Motivation: z.string(),
  Relations: z.string(),
});

export interface OutlineFeedback {
  Deviation: string;
  Suggestion: string;
}

export const OutlineFeedbackSchema = z.object({
  Deviation: z.string(),
  Suggestion: z.string(),
});

export interface CharacterVoice {
  Name: string;
  Rules: string[];
}

export const CharacterVoiceSchema = z.object({
  Name: z.string(),
  Rules: z.array(z.string()),
});

export interface WritingStyleRules {
  Volume: number;
  Arc: number;
  Prose: string[];
  Dialogue: CharacterVoice[];
  Taboos: string[];
  UpdatedAt: string;
}

export const WritingStyleRulesSchema = z.object({
  Volume: z.number().int().nonnegative(),
  Arc: z.number().int().nonnegative(),
  Prose: z.array(z.string()),
  Dialogue: z.array(CharacterVoiceSchema),
  Taboos: z.array(z.string()),
  UpdatedAt: z.string(),
});

export interface RelatedChapter {
  Chapter: number;
  Reason: string;
}

export const RelatedChapterSchema = z.object({
  Chapter: z.number().int().positive(),
  Reason: z.string(),
});

export interface RecallItem {
  Kind: string;
  Key: string;
  Chapter: number;
  Reason: string;
  Summary: string;
}

export const RecallItemSchema = z.object({
  Kind: z.string(),
  Key: z.string(),
  Chapter: z.number().int(),
  Reason: z.string(),
  Summary: z.string(),
});

export interface CommitResult {
  Chapter: number;
  Committed: boolean;
  WordCount: number;
  NextChapter: number;
  ReviewRequired: boolean;
  ReviewReason: string;
  HookType: string;
  DominantStrand: string;
  Feedback: OutlineFeedback | null;
  ArcEnd: boolean;
  VolumeEnd: boolean;
  Volume: number;
  Arc: number;
  NeedsExpansion: boolean;
  NeedsNewVolume: boolean;
  NextVolume: number;
  NextArc: number;
  BookComplete: boolean;
  Flow: string;
}

export const CommitResultSchema = z.object({
  Chapter: z.number().int().positive(),
  Committed: z.boolean(),
  WordCount: z.number().int().nonnegative(),
  NextChapter: z.number().int(),
  ReviewRequired: z.boolean(),
  ReviewReason: z.string(),
  HookType: z.string(),
  DominantStrand: z.string(),
  Feedback: OutlineFeedbackSchema.nullable(),
  ArcEnd: z.boolean(),
  VolumeEnd: z.boolean(),
  Volume: z.number().int(),
  Arc: z.number().int(),
  NeedsExpansion: z.boolean(),
  NeedsNewVolume: z.boolean(),
  NextVolume: z.number().int(),
  NextArc: z.number().int(),
  BookComplete: z.boolean(),
  Flow: z.string(),
});