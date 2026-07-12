import { z } from "zod";
export const ScopeKind = z.enum(["chapter", "arc", "volume", "global"]); export type ScopeKind = z.infer<typeof ScopeKind>;
export const ScopeSchema = z.object({ kind: ScopeKind, chapter: z.number().int().optional(), volume: z.number().int().optional(), arc: z.number().int().optional() }).strict(); export type Scope = z.infer<typeof ScopeSchema>;
export const CheckpointSchema = z.object({ seq: z.number().int().nonnegative(), scope: ScopeSchema, step: z.string(), artifact: z.string().optional(), digest: z.string().optional(), occurred_at: z.string() }).strict(); export type Checkpoint = z.infer<typeof CheckpointSchema>;
export const SteerKind = z.enum(["immediate", "next_chapter"]); export type SteerKind = z.infer<typeof SteerKind>;
export const PendingSteerSchema = z.object({ kind: SteerKind, input: z.string() }).strict(); export type PendingSteer = z.infer<typeof PendingSteerSchema>;
