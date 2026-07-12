import { z } from "zod";

export interface Novel {
  Name: string;
  TotalChapters: number;
}

export const NovelSchema = z.object({
  Name: z.string(),
  TotalChapters: z.number().int().nonnegative(),
});

export interface OutlineEntry {
  Chapter: number;
  Title: string;
  CoreEvent: string;
  Hook: string;
  Scenes: string[];
}

export const OutlineEntrySchema = z.object({
  Chapter: z.number().int().positive(),
  Title: z.string(),
  CoreEvent: z.string(),
  Hook: z.string(),
  Scenes: z.array(z.string()),
});

export interface Character {
  Name: string;
  Aliases: string[];
  Role: string;
  Description: string;
  Arc: string;
  Traits: string[];
  Tier: string;
}

export const CharacterSchema = z.object({
  Name: z.string(),
  Aliases: z.array(z.string()),
  Role: z.string(),
  Description: z.string(),
  Arc: z.string(),
  Traits: z.array(z.string()),
  Tier: z.string(),
});

export interface VolumeOutline {
  Index: number;
  Title: string;
  Theme: string;
  Final: boolean;
  Arcs: ArcOutline[];
}

export const VolumeOutlineSchema: z.ZodType<VolumeOutline> = z.object({
  Index: z.number().int().nonnegative(),
  Title: z.string(),
  Theme: z.string(),
  Final: z.boolean(),
  Arcs: z.lazy(() => z.array(ArcOutlineSchema)),
});

export interface ArcOutline {
  Index: number;
  Title: string;
  Goal: string;
  EstimatedChapters: number;
  Chapters: OutlineEntry[];
}

export const ArcOutlineSchema: z.ZodType<ArcOutline> = z.object({
  Index: z.number().int().nonnegative(),
  Title: z.string(),
  Goal: z.string(),
  EstimatedChapters: z.number().int().nonnegative(),
  Chapters: z.array(OutlineEntrySchema),
});

export interface WorldRule {
  Category: string;
  Rule: string;
  Boundary: string;
}

export const WorldRuleSchema = z.object({
  Category: z.string(),
  Rule: z.string(),
  Boundary: z.string(),
});

export interface StoryCompass {
  EndingDirection: string;
  OpenThreads: string[];
  EstimatedScale: string;
  LastUpdated: number;
}

export const StoryCompassSchema = z.object({
  EndingDirection: z.string(),
  OpenThreads: z.array(z.string()),
  EstimatedScale: z.string(),
  LastUpdated: z.number().int().nonnegative(),
});