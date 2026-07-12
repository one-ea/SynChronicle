import { z } from "zod";
import { CommitResultSchema, type CommitResult } from "./writing.js";

export const CommitStage = z.enum(["started", "state_applied", "progress_marked", "signal_saved"]);
export type CommitStage = z.infer<typeof CommitStage>;

export interface PendingCommit {
  Chapter: number;
  Stage: CommitStage;
  Summary: string;
  HookType: string;
  DominantStrand: string;
  Result: CommitResult | null;
  StartedAt: string;
  UpdatedAt: string;
}

export const PendingCommitSchema: z.ZodType<PendingCommit> = z.object({
  Chapter: z.number().int().positive(),
  Stage: CommitStage,
  Summary: z.string(),
  HookType: z.string(),
  DominantStrand: z.string(),
  Result: CommitResultSchema.nullable(),
  StartedAt: z.string(),
  UpdatedAt: z.string(),
});