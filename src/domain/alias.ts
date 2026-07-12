import { z } from "zod";
export const AliasSpecSchema = z.object({ provider: z.string(), model: z.string() }).strict(); export type AliasSpec = z.infer<typeof AliasSpecSchema>;
export const AliasEntrySchema = z.object({ alias: z.string(), spec: AliasSpecSchema }).strict(); export type AliasEntry = z.infer<typeof AliasEntrySchema>;
export const AliasModelSchema = z.object({ aliases: z.array(AliasEntrySchema) }).strict(); export type AliasModel = z.infer<typeof AliasModelSchema>;
