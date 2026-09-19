import { z } from "zod";

export const ForeshadowLifecycleStageSchema = z.enum([
  "planted", // 埋设 (初次隐晦植入)
  "hinted", // 暗示 (侧面强化与线索微露)
  "misled", // 误导 (红鲱鱼/假象引向)
  "resolved", // 收束 (揭晓/兑现)
]);
export type ForeshadowLifecycleStage = z.infer<typeof ForeshadowLifecycleStageSchema>;

export const ForeshadowTypeSchema = z.enum([
  "mystery", // 谜面布设
  "secret", // 角色秘密
  "worldview", // 世界观悬疑
  "tension", // 关系张力
  "prophecy", // 预言
  "chekhov", // 契诃夫之枪
  "unfinished", // 未竟事业
  "identity", // 隐藏身份
]);
export type ForeshadowType = z.infer<typeof ForeshadowTypeSchema>;

export const ForeshadowTrackSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  type: ForeshadowTypeSchema.default("mystery"),
  stage: ForeshadowLifecycleStageSchema.default("planted"),
  plantedChapter: z.number().int().positive(),
  lastUpdatedChapter: z.number().int().positive().optional(),
  resolvedChapter: z.number().int().positive().optional(),
  targetArc: z.string().optional(),
  urgency: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  missedRecoveries: z.number().int().nonnegative().default(0), // 错过回收节点次数，>=3 自动升级 critical
});
export type ForeshadowTrack = z.infer<typeof ForeshadowTrackSchema>;

export const ForeshadowFileSchema = z.object({
  items: z.array(ForeshadowTrackSchema).default([]),
  updatedAt: z.string().optional(),
});
export type ForeshadowFile = z.infer<typeof ForeshadowFileSchema>;
