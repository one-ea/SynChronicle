import { z } from "zod";

export interface CastEntry {
  Name: string;
  Aliases: string[];
  BriefRole: string;
  FirstSeenChapter: number;
  LastSeenChapter: number;
  AppearanceCount: number;
  AppearanceChapters: number[];
  Promoted: boolean;
}

export const CastEntrySchema = z.object({
  Name: z.string(),
  Aliases: z.array(z.string()),
  BriefRole: z.string(),
  FirstSeenChapter: z.number().int(),
  LastSeenChapter: z.number().int(),
  AppearanceCount: z.number().int().nonnegative(),
  AppearanceChapters: z.array(z.number().int()),
  Promoted: z.boolean(),
});

export interface CastIntro {
  Name: string;
  BriefRole: string;
}

export const CastIntroSchema = z.object({
  Name: z.string(),
  BriefRole: z.string(),
});