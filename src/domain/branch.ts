import { z } from "zod";

export const StoryBranchSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  sourceChapter: z.number().int().positive(),
  createdAt: z.string(),
  notes: z.string().default(""),
  active: z.boolean().default(false),
});
export type StoryBranch = z.infer<typeof StoryBranchSchema>;

export const BranchesManifestSchema = z.object({
  branches: z.array(StoryBranchSchema).default([]),
  activeBranchId: z.string().optional(),
});
export type BranchesManifest = z.infer<typeof BranchesManifestSchema>;
