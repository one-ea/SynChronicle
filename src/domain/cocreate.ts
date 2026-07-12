import { z } from "zod";
export const CoCreateStage = z.enum(["intent", "premise", "outline", "ready"]); export type CoCreateStage = z.infer<typeof CoCreateStage>;
export const SimulationStage = z.enum(["source", "merge", "complete"]); export type SimulationStage = z.infer<typeof SimulationStage>;
export const IntentKind = z.enum(["new", "continue", "import"]); export type IntentKind = z.infer<typeof IntentKind>;
export const CoCreateKind = z.enum(["quick", "guided"]); export type CoCreateKind = z.infer<typeof CoCreateKind>;
export const QuickConfigSchema = z.object({ prompt: z.string(), style: z.string().optional() }).strict(); export type QuickConfig = z.infer<typeof QuickConfigSchema>;
export const CocreateConfigSchema = z.object({ kind: CoCreateKind, intent: IntentKind, stage: CoCreateStage, quick: QuickConfigSchema.optional() }).strict(); export type CocreateConfig = z.infer<typeof CocreateConfigSchema>;
