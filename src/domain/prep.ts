import { z } from "zod";

export const PrepStage = z.enum(["intent", "premise", "worldview", "outline", "ready"]);
export type PrepStage = z.infer<typeof PrepStage>;

export const PrepMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  ts: z.string(),
  stage: PrepStage,
  suggestions: z.array(z.string()).default([]),
});
export type PrepMessage = z.infer<typeof PrepMessageSchema>;

export const PrepSessionSchema = z.object({
  id: z.string(),
  bookId: z.string(),
  status: z.enum(["active", "confirmed", "abandoned"]).default("active"),
  stage: PrepStage.default("intent"),
  rounds: z.number().int().nonnegative().default(0),
  title: z.string().default(""),
  messages: z.array(PrepMessageSchema).default([]),
  distilledBrief: z.string().default(""),
  createdAt: z.string(),
  updatedAt: z.string(),
  confirmedAt: z.string().nullable().default(null),
});
export type PrepSession = z.infer<typeof PrepSessionSchema>;

export const PREP_STAGES: PrepStage[] = ["intent", "premise", "worldview", "outline", "ready"];
