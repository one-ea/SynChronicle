import { z } from "zod";

export const AdviceKind = z.enum(["prep-missing-conflict", "prep-missing-protagonist", "prep-outline-empty", "constitution-empty", "score-drop", "consecutive-low", "review-queue-growing", "budget-usage-high", "aitone-worsening", "foreshadow-urgent"]);
export const AdviceSchema = z.object({ id: z.string(), kind: AdviceKind, severity: z.enum(["info", "warn", "critical"]).default("info"), message: z.string(), actionHint: z.string().default(""), scope: z.string().default(""), bornAt: z.string() });
export type Advice = z.infer<typeof AdviceSchema>;
export const AdviceFileSchema = z.object({ dismissed: z.array(z.string()).default([]), updatedAt: z.string() });
