import { z } from "zod";

export const NovelSchema = z.object({ name: z.string(), total_chapters: z.number().int().nonnegative() }).strict();
export type Novel = z.infer<typeof NovelSchema>;
export const OutlineEntrySchema = z.object({ chapter: z.number().int().positive(), title: z.string(), core_event: z.string(), hook: z.string(), scenes: z.array(z.string()) }).strict();
export type OutlineEntry = z.infer<typeof OutlineEntrySchema>;
export const CharacterSchema = z.object({ name: z.string(), aliases: z.array(z.string()).optional(), role: z.string(), description: z.string(), arc: z.string(), traits: z.array(z.string()), tier: z.string().optional() }).strict();
export type Character = z.infer<typeof CharacterSchema>;
export const ArcOutlineSchema: z.ZodType<ArcOutline> = z.object({ index: z.number().int().nonnegative(), title: z.string(), goal: z.string(), estimated_chapters: z.number().int().nonnegative().optional(), chapters: z.array(OutlineEntrySchema) }).strict();
export type ArcOutline = { index: number; title: string; goal: string; estimated_chapters?: number; chapters: OutlineEntry[] };
export const VolumeOutlineSchema: z.ZodType<VolumeOutline> = z.object({ index: z.number().int().nonnegative(), title: z.string(), theme: z.string(), final: z.boolean().optional(), arcs: z.array(ArcOutlineSchema) }).strict();
export type VolumeOutline = { index: number; title: string; theme: string; final?: boolean; arcs: ArcOutline[] };
export const WorldRuleSchema = z.object({ category: z.string(), rule: z.string(), boundary: z.string() }).strict();
export type WorldRule = z.infer<typeof WorldRuleSchema>;
export const StoryCompassSchema = z.object({ ending_direction: z.string(), open_threads: z.array(z.string()).optional(), estimated_scale: z.string().optional(), last_updated: z.number().int().nonnegative().optional() }).strict();
export type StoryCompass = z.infer<typeof StoryCompassSchema>;
