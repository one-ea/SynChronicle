import { z } from "zod";
export const DecisionKind = z.enum(["continue", "pause", "abort", "retry"]); export type DecisionKind = z.infer<typeof DecisionKind>;
export const DecisionSchema = z.object({ kind: DecisionKind, reason: z.string().optional(), payload: z.unknown().optional() }).strict(); export type Decision = z.infer<typeof DecisionSchema>;
