import { z } from "zod";

export const ForeshadowLifecycleStageSchema = z.enum([
  "planted", // 埋设 (初次隐晦植入)
  "hinted", // 暗示 (侧面强化与线索微露)
  "misled", // 误导 (红鲱鱼/假象引向)
  "resolved", // 收束 (揭晓/兑现)
]);
export type ForeshadowLifecycleStage = z.infer<typeof ForeshadowLifecycleStageSchema>;

export const ForeshadowTrackSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  stage: ForeshadowLifecycleStageSchema.default("planted"),
  plantedChapter: z.number().int().positive(),
  lastUpdatedChapter: z.number().int().positive().optional(),
  resolvedChapter: z.number().int().positive().optional(),
  targetArc: z.string().optional(),
  urgency: z.enum(["low", "medium", "high", "critical"]).default("medium"),
});
export type ForeshadowTrack = z.infer<typeof ForeshadowTrackSchema>;

export const ForeshadowFileSchema = z.object({
  items: z.array(ForeshadowTrackSchema).default([]),
  updatedAt: z.string().optional(),
});
export type ForeshadowFile = z.infer<typeof ForeshadowFileSchema>;
