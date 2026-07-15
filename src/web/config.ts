import { randomUUID } from "node:crypto";
import { z } from "zod";

export const WebConfigSchema = z.object({
  host: z.string().default("0.0.0.0"),
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  trustProxy: z.union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")]).default(false),
  databaseUrl: z.string().min(1),
  publicUrl: z.string().url(),
  sessionSecret: z.string().min(32),
  credentialMasterKeys: z.string().min(1),
  credentialMasterKeyVersion: z.string().min(1),
  workerId: z.string().min(1).default(() => randomUUID()),
});

export type WebConfig = z.infer<typeof WebConfigSchema>;

export function loadWebConfig(): WebConfig {
  return WebConfigSchema.parse({
    host: process.env.HOST,
    port: process.env.PORT,
    trustProxy: process.env.TRUST_PROXY,
    databaseUrl: process.env.DATABASE_URL,
    publicUrl: process.env.PUBLIC_URL,
    sessionSecret: process.env.SESSION_SECRET,
    credentialMasterKeys: process.env.PROJECT_CREDENTIAL_MASTER_KEYS,
    credentialMasterKeyVersion: process.env.PROJECT_CREDENTIAL_MASTER_KEY_VERSION,
    workerId: process.env.WORKER_ID,
  });
}
