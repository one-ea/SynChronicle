import { z } from "zod";
export const LessonStatus = z.enum(["active", "retired"]);
export const LessonSchema = z.object({ id: z.string(), dimension: z.string(), pattern: z.string().max(60), lesson: z.string().max(120), evidenceChapters: z.array(z.number().int().positive()).min(2), bornAt: z.string(), useCount: z.number().int().nonnegative().default(0), scoreDeltas: z.array(z.number()).default([]), status: LessonStatus.default("active"), retiredAt: z.string().nullable().default(null), retireReason: z.string().default("") });
export type Lesson = z.infer<typeof LessonSchema>;
export const EvolutionFileSchema = z.object({ lessons: z.array(LessonSchema).default([]), chapterScores: z.array(z.object({ chapter: z.number().int().positive(), golden: z.number(), aitone: z.number(), rewrites: z.number().default(0), reflectionIssues: z.array(z.string()).default([]) })).default([]), updatedAt: z.string() });
export type EvolutionFile = z.infer<typeof EvolutionFileSchema>;
