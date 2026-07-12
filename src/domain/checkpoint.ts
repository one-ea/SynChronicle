import { z } from "zod";

export const ScopeKind = z.enum(["chapter", "arc", "volume", "global"]);
export type ScopeKind = z.infer<typeof ScopeKind>;

export interface Scope {
  Kind: ScopeKind;
  Chapter: number;
  Volume: number;
  Arc: number;
}

export const ScopeSchema = z.object({
  Kind: ScopeKind,
  Chapter: z.number().int(),
  Volume: z.number().int(),
  Arc: z.number().int(),
});

export interface Checkpoint {
  Seq: number;
  Scope: Scope;
  Step: string;
  Artifact: string;
  Digest: string;
  OccurredAt: string;
}

export const CheckpointSchema = z.object({
  Seq: z.number().int().nonnegative(),
  Scope: ScopeSchema,
  Step: z.string(),
  Artifact: z.string(),
  Digest: z.string(),
  OccurredAt: z.string(),
});