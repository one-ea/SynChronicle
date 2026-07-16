import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { parseProviderAllowedHosts, type ProviderAllowedHosts } from "../providers/urlPolicy.js";

const ProviderAllowedHostsSchema = z.preprocess(
  (value) => value === undefined ? "" : value,
  z.union([
    z.string().transform(parseProviderAllowedHosts),
    z.custom<ProviderAllowedHosts>((value) => value instanceof Map),
  ]),
);

function parseTrustedProxies(value: unknown): false | string[] {
  if (value === undefined || value === false || value === "false" || value === "") return false;
  if (value === true || value === "true" || typeof value !== "string") throw new Error("TRUST_PROXY must contain explicit IP or CIDR entries");
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!entries.length) return false;
  for (const entry of entries) {
    const [address, prefix, extra] = entry.split("/");
    const family = isIP(address ?? "");
    const maxPrefix = family === 4 ? 32 : family === 6 ? 128 : -1;
    if (extra !== undefined || maxPrefix < 0 || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) > maxPrefix))) {
      throw new Error("TRUST_PROXY must contain explicit IP or CIDR entries");
    }
  }
  return entries;
}

export const WebConfigSchema = z.object({
  host: z.string().default("0.0.0.0"),
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  trustProxy: z.unknown().transform(parseTrustedProxies).default(false),
  databaseUrl: z.string().min(1),
  publicUrl: z.string().url(),
  sessionSecret: z.string().min(32),
  credentialMasterKeys: z.string().min(1),
  credentialMasterKeyVersion: z.string().min(1),
  providerAllowedHosts: ProviderAllowedHostsSchema,
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
    providerAllowedHosts: process.env.PROJECT_PROVIDER_ALLOWED_HOSTS,
    workerId: process.env.WORKER_ID,
  });
}
