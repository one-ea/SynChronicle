import { z } from "zod";

export interface TimelineEvent {
  Chapter: number;
  Time: string;
  Event: string;
  Characters: string[];
}

export const TimelineEventSchema = z.object({
  Chapter: z.number().int().positive(),
  Time: z.string(),
  Event: z.string(),
  Characters: z.array(z.string()),
});

export interface ForeshadowEntry {
  ID: string;
  Description: string;
  PlantedAt: number;
  Status: string;
  ResolvedAt: number;
}

export const ForeshadowEntrySchema = z.object({
  ID: z.string(),
  Description: z.string(),
  PlantedAt: z.number().int(),
  Status: z.string(),
  ResolvedAt: z.number().int(),
});

export interface ForeshadowUpdate {
  ID: string;
  Action: string;
  Description: string;
}

export const ForeshadowUpdateSchema = z.object({
  ID: z.string(),
  Action: z.string(),
  Description: z.string(),
});

export interface RelationshipEntry {
  CharacterA: string;
  CharacterB: string;
  Relation: string;
  Chapter: number;
}

export const RelationshipEntrySchema = z.object({
  CharacterA: z.string(),
  CharacterB: z.string(),
  Relation: z.string(),
  Chapter: z.number().int(),
});

export interface ConsistencyIssue {
  Type: string;
  Severity: string;
  Description: string;
  Evidence: string;
  Suggestion: string;
}

export const ConsistencyIssueSchema = z.object({
  Type: z.string(),
  Severity: z.string(),
  Description: z.string(),
  Evidence: z.string(),
  Suggestion: z.string(),
});

export interface DimensionScore {
  Dimension: string;
  Score: number;
  Verdict: string;
  Comment: string;
}

export const DimensionScoreSchema = z.object({
  Dimension: z.string(),
  Score: z.number().int(),
  Verdict: z.string(),
  Comment: z.string(),
});

export interface ReviewEntry {
  Chapter: number;
  Scope: string;
  Issues: ConsistencyIssue[];
  Dimensions: DimensionScore[];
  ContractStatus: string;
  ContractMisses: string[];
  ContractNotes: string;
  Verdict: string;
  Summary: string;
  AffectedChapters: number[];
}

export const ReviewEntrySchema = z.object({
  Chapter: z.number().int().positive(),
  Scope: z.string(),
  Issues: z.array(ConsistencyIssueSchema),
  Dimensions: z.array(DimensionScoreSchema),
  ContractStatus: z.string(),
  ContractMisses: z.array(z.string()),
  ContractNotes: z.string(),
  Verdict: z.string(),
  Summary: z.string(),
  AffectedChapters: z.array(z.number().int()),
});