import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, ne } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { auditEvents, providerCredentials } from "../db/schema/index.js";
import { decryptCredential, encryptCredential, type CredentialEnvelope, type MasterKeyRegistry } from "./envelope.js";

export type RotatableCredential = {
  id: string;
  userId: string;
  provider: string;
  status: "active" | "disabled" | "revoked" | "invalid";
  envelope: CredentialEnvelope;
};

export async function rotateCredentialBatch(input: {
  rows: RotatableCredential[];
  registry: MasterKeyRegistry;
  dryRun: boolean;
  save: (row: RotatableCredential, envelope: CredentialEnvelope) => Promise<void>;
  audit: (row: RotatableCredential, previousVersion: string) => Promise<void>;
}): Promise<{ examined: number; rotated: number; skipped: number }> {
  let rotated = 0;
  let skipped = 0;
  for (const row of input.rows) {
    if (!(["active", "disabled"] as const).includes(row.status as "active" | "disabled") || row.envelope.keyVersion === input.registry.currentVersion) {
      skipped++;
      continue;
    }
    const aad = { userId: row.userId, credentialId: row.id, provider: row.provider };
    let plaintext = decryptCredential(input.registry, row.envelope, aad);
    try {
      const envelope = encryptCredential(input.registry, plaintext, aad);
      if (!input.dryRun) {
        await input.save(row, envelope);
        await input.audit(row, row.envelope.keyVersion);
      }
      rotated++;
    } finally {
      plaintext = "";
    }
  }
  return { examined: input.rows.length, rotated, skipped };
}

export async function walkCredentialPages<T extends { id: string }>(input: {
  batchSize: number;
  fetchPage: (cursor: string | undefined, limit: number) => Promise<T[]>;
  processPage: (rows: T[]) => Promise<{ examined: number; rotated: number; skipped: number }>;
}): Promise<{ examined: number; rotated: number; skipped: number }> {
  const total = { examined: 0, rotated: 0, skipped: 0 };
  let cursor: string | undefined;
  while (true) {
    const rows = await input.fetchPage(cursor, input.batchSize);
    if (!rows.length) return total;
    const result = await input.processPage(rows);
    total.examined += result.examined;
    total.rotated += result.rotated;
    total.skipped += result.skipped;
    cursor = rows.at(-1)!.id;
    if (rows.length < input.batchSize) return total;
  }
}

export async function rotateDatabaseCredentials(database: Database, registry: MasterKeyRegistry, options: { dryRun: boolean; batchSize: number; requestId?: string }): Promise<{ examined: number; rotated: number; skipped: number }> {
  const requestId = options.requestId ?? randomUUID();
  const total = { examined: 0, rotated: 0, skipped: 0 };
  if (options.dryRun) {
    return walkCredentialPages({
      batchSize: options.batchSize,
      fetchPage: async (cursor, limit) => database.select().from(providerCredentials).where(and(inArray(providerCredentials.status, ["active", "disabled"]), ne(providerCredentials.keyVersion, registry.currentVersion), ...(cursor ? [gt(providerCredentials.id, cursor)] : []))).orderBy(asc(providerCredentials.id)).limit(limit).then((rows) => rows.map(toRotatable)),
      processPage: (rows) => rotateCredentialBatch({ rows, registry, dryRun: true, save: async () => undefined, audit: async () => undefined }),
    });
  }
  while (true) {
    const result = await database.transaction(async (transaction) => {
      const rows = await transaction.select().from(providerCredentials).where(and(inArray(providerCredentials.status, ["active", "disabled"]), ne(providerCredentials.keyVersion, registry.currentVersion))).orderBy(asc(providerCredentials.id)).limit(options.batchSize).for("update", { skipLocked: true });
      return rotateCredentialBatch({
        rows: rows.map(toRotatable),
        registry,
        dryRun: false,
        save: async (row, envelope) => {
          await transaction.update(providerCredentials).set({ ciphertext: JSON.stringify(envelope), encryptedDataKey: envelope.wrappedDataKey, algorithmVersion: envelope.version, keyVersion: envelope.keyVersion, updatedAt: new Date() }).where(and(eq(providerCredentials.id, row.id), eq(providerCredentials.keyVersion, row.envelope.keyVersion)));
        },
        audit: async (row, previousVersion) => {
          await transaction.insert(auditEvents).values({ userId: row.userId, action: "credential.reencrypt", targetType: "provider_credential", targetId: row.id, result: "success", requestId: `${requestId}:${row.id}`, metadata: { provider: row.provider, previousKeyVersion: previousVersion, keyVersion: registry.currentVersion } }).onConflictDoNothing();
        },
      });
    });
    total.examined += result.examined;
    total.rotated += result.rotated;
    total.skipped += result.skipped;
    if (result.examined < options.batchSize) return total;
  }
}

function toRotatable(row: typeof providerCredentials.$inferSelect): RotatableCredential {
  return { id: row.id, userId: row.userId, provider: row.provider, status: row.status, envelope: JSON.parse(row.ciphertext) as CredentialEnvelope };
}
