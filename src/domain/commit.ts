import { z } from "zod";
import { CommitResultSchema } from "./writing.js";
export const CommitStage = z.enum(["started", "state_applied", "progress_marked", "signal_saved"]); export type CommitStage = z.infer<typeof CommitStage>;
export const PendingCommitSchema = z.object({ chapter: z.number().int().positive(), stage: CommitStage, summary: z.string().optional(), hook_type: z.string().optional(), dominant_strand: z.string().optional(), result: CommitResultSchema.nullable().optional(), started_at: z.string().optional(), updated_at: z.string().optional() }).strict(); export type PendingCommit = z.infer<typeof PendingCommitSchema>;
