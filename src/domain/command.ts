import { z } from "zod";
export const CommandMetaSchema = z.object({ command: z.string(), duration_ms: z.number().int().nonnegative().optional() }).strict(); export type CommandMeta = z.infer<typeof CommandMetaSchema>;
export const CommandResultSchema = z.object({ ok: z.boolean(), output: z.string().optional(), error: z.string().optional(), meta: CommandMetaSchema.optional() }).strict(); export type CommandResult = z.infer<typeof CommandResultSchema>;
