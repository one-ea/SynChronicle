import { z } from "zod";
export const RuntimeEventKind = z.enum(["dispatch", "check", "tool", "system", "review", "reflection", "error", "context"]); export type RuntimeEventKind = z.infer<typeof RuntimeEventKind>;
export const ModelParamsSchema = z.object({ provider: z.string().optional(), model: z.string().optional() }).strict(); export type ModelParams = z.infer<typeof ModelParamsSchema>;
export const WriterParamsSchema = ModelParamsSchema.extend({ chapter: z.number().int().positive().optional() }).strict(); export type WriterParams = z.infer<typeof WriterParamsSchema>;
export const EditorParamsSchema = ModelParamsSchema.extend({ scope: z.string().optional() }).strict(); export type EditorParams = z.infer<typeof EditorParamsSchema>;
export const ReviewSchema = z.object({ verdict: z.string(), summary: z.string().optional() }).strict(); export type Review = z.infer<typeof ReviewSchema>;
export const ReflectionRuntimePayloadSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("started"), maxRounds: z.number().int().positive() }).strict(),
  z.object({ phase: z.literal("review_completed"), round: z.number().int().positive(), score: z.number(), passed: z.boolean() }).strict(),
  z.object({ phase: z.literal("revision_started"), round: z.number().int().positive(), issues: z.array(z.string()) }).strict(),
  z.object({ phase: z.literal("completed"), rounds: z.number().int().nonnegative(), score: z.number(), passed: z.boolean() }).strict(),
]); export type ReflectionRuntimePayload = z.infer<typeof ReflectionRuntimePayloadSchema>;
const RuntimeEventFields = { id: z.string().optional(), sequence: z.number().int().nonnegative().optional(), time: z.string().optional(), agent: z.string().optional(), message: z.string().optional() };
const genericEvent = (type: Exclude<RuntimeEventKind, "reflection">) => z.object({ type: z.literal(type), ...RuntimeEventFields, payload: z.unknown().optional() }).strict();
export const SystemEventSchema = genericEvent("system"); export type SystemEvent = z.infer<typeof SystemEventSchema>;
export const ToolEventSchema = z.object({ type: z.literal("tool"), ...RuntimeEventFields, payload: z.unknown().optional(), tool: z.string() }).strict(); export type ToolEvent = z.infer<typeof ToolEventSchema>;
export const ReflectionRuntimeEventSchema = z.object({ type: z.literal("reflection"), ...RuntimeEventFields, payload: ReflectionRuntimePayloadSchema }).strict();
export const RuntimeEventSchema = z.discriminatedUnion("type", [genericEvent("dispatch"), genericEvent("check"), genericEvent("tool"), SystemEventSchema, genericEvent("review"), ReflectionRuntimeEventSchema, genericEvent("error"), genericEvent("context")]); export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;
export type DispatchEvent = RuntimeEvent & { type: "dispatch" }; export type CheckEvent = RuntimeEvent & { type: "check" }; export type ReviewEvent = RuntimeEvent & { type: "review" }; export type ErrorEvent = RuntimeEvent & { type: "error" }; export type ContextEvent = RuntimeEvent & { type: "context" };
export type ReflectionRuntimeEvent = z.infer<typeof ReflectionRuntimeEventSchema>;
