import { z } from "zod";

export const EntityTypeSchema = z.enum(["character", "faction", "item", "location"]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const RelationTypeSchema = z.enum([
  "ally", // 盟友/支持
  "enemy", // 敌对/冲突
  "mentor", // 师徒/引领
  "kin", // 亲属/羁绊
  "subordinate", // 上下级/隶属
  "neutral", // 中立/观望
]);
export type RelationType = z.infer<typeof RelationTypeSchema>;

export const CharacterStateSchema = z.object({
  chapter: z.number().int().positive(),
  mood: z.string().default("平淡"),
  goals: z.array(z.string()).default([]),
  statusNote: z.string().optional(),
});
export type CharacterState = z.infer<typeof CharacterStateSchema>;

export const EntityRelationSchema = z.object({
  targetId: z.string().min(1),
  type: RelationTypeSchema,
  description: z.string().optional(),
  strength: z.number().min(-100).max(100).default(0), // 亲和度/好感度 (-100 到 100)
});
export type EntityRelation = z.infer<typeof EntityRelationSchema>;

export const EntitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: EntityTypeSchema,
  aliases: z.array(z.string()).default([]),
  description: z.string().default(""),
  relations: z.array(EntityRelationSchema).default([]),
  states: z.array(CharacterStateSchema).default([]),
  firstAppearedChapter: z.number().int().positive().optional(),
  lastAppearedChapter: z.number().int().positive().optional(),
});
export type Entity = z.infer<typeof EntitySchema>;

export const EntitiesFileSchema = z.object({
  entities: z.array(EntitySchema).default([]),
  updatedAt: z.string().optional(),
});
export type EntitiesFile = z.infer<typeof EntitiesFileSchema>;
