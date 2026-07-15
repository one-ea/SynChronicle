import { randomUUID } from "node:crypto";
import { z } from "zod";

export const WebConfigSchema = z.object({
  host: z.string().default("0.0.0.0"),
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  databaseUrl: z.string().min(1),
  publicUrl: z.string().url(),
  sessionSecret: z.string().min(32),
  credentialMasterKey: z.string().min(32),
  workerId: z.string().min(1).default(() => randomUUID()),
});

export type WebConfig = z.infer<typeof WebConfigSchema>;

export function loadWebConfig(): WebConfig {
  return WebConfigSchema.parse({
    host: process.env.HOST,
    port: process.env.PORT,
    databaseUrl: process.env.DATABASE_URL,
    publicUrl: process.env.PUBLIC_URL,
    sessionSecret: process.env.SESSION_SECRET,
    credentialMasterKey: process.env.CREDENTIAL_MASTER_KEY,
    workerId: process.env.WORKER_ID,
  });
}
