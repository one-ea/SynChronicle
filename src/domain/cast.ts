import { z } from "zod";
export const CastEntrySchema = z.object({ name: z.string(), aliases: z.array(z.string()).optional(), brief_role: z.string().optional(), first_seen_chapter: z.number().int(), last_seen_chapter: z.number().int(), appearance_count: z.number().int().nonnegative(), appearance_chapters: z.array(z.number().int()), promoted: z.boolean().optional() }).strict(); export type CastEntry = z.infer<typeof CastEntrySchema>;
export const CastIntroSchema = z.object({ name: z.string(), brief_role: z.string() }).strict(); export type CastIntro = z.infer<typeof CastIntroSchema>;
export const CastSchema = z.array(CastEntrySchema); export type Cast = z.infer<typeof CastSchema>;
export const TrackerSchema = z.object({ entity: z.string(), field: z.string(), value: z.string() }).strict(); export type Tracker = z.infer<typeof TrackerSchema>;
export const TrackingSchema = z.array(TrackerSchema); export type Tracking = z.infer<typeof TrackingSchema>;
