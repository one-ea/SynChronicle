import { z } from "zod";
export const StateChangeSchema = z.object({ chapter: z.number().int().positive(), entity: z.string(), field: z.string(), old_value: z.string().optional(), new_value: z.string(), reason: z.string().optional() }).strict(); export type StateChange = z.infer<typeof StateChangeSchema>;
