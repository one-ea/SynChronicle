import { z } from "zod";
export const Visibility = z.enum(["public", "unlisted", "private"]);
export const PublishedEntrySchema = z.object({ id: z.string(), title: z.string().min(1).max(60), authorName: z.string().default("匿名"), synopsis: z.string().max(300).default(""), tags: z.array(z.string().max(12)).max(6).default([]), visibility: Visibility.default("public"), hue: z.number().int().min(0).max(360), publishedAt: z.string(), updatedAt: z.string(), stats: z.object({ chapters: z.number().int(), words: z.number().int() }).default({ chapters: 0, words: 0 }), aigcLabel: z.boolean().default(true) });
export type PublishedEntry = z.infer<typeof PublishedEntrySchema>;
export const PublishedFileSchema = z.object({ entries: z.array(PublishedEntrySchema).default([]), updatedAt: z.string() });
export function titleHue(title: string): number { return [...title].reduce((sum, char) => sum + char.codePointAt(0)!, 0) % 360; }
