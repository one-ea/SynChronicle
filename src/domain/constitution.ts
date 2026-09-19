import { z } from "zod";

/**
 * 项目宪法（specs/2026-09-19-p6-consistency-and-platform R1）。
 * 全书结构化锁定文件：世界规则、能力代价、禁写信息、秘密揭晓计划、人物行为边界。
 */

export const SecretRevealSchema = z.object({
  secret: z.string().min(1),
  revealAt: z.string().min(1), // 例如 "第 3 卷" 或 "第 42 章"
});
export type SecretReveal = z.infer<typeof SecretRevealSchema>;

export const ConstitutionSchema = z.object({
  worldRules: z.array(z.string()).default([]),
  abilityCosts: z.array(z.string()).default([]),
  forbiddenInfo: z.array(z.string()).default([]),
  secretReveals: z.array(SecretRevealSchema).default([]),
  characterBoundaries: z.array(z.string()).default([]),
  updatedAt: z.string().optional(),
});
export type Constitution = z.infer<typeof ConstitutionSchema>;

export function emptyConstitution(): Constitution {
  return { worldRules: [], abilityCosts: [], forbiddenInfo: [], secretReveals: [], characterBoundaries: [] };
}

export function isEmptyConstitution(constitution: Constitution): boolean {
  return !constitution.worldRules.length && !constitution.abilityCosts.length && !constitution.forbiddenInfo.length && !constitution.secretReveals.length && !constitution.characterBoundaries.length;
}
