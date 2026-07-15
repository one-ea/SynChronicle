import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Database } from "../db/client.js";
import { auditEvents, providerCredentials } from "../db/schema/index.js";
import type { CredentialEnvelope } from "./envelope.js";
import type { CredentialRecord, CredentialRepository } from "./service.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function fromRow(row: typeof providerCredentials.$inferSelect): CredentialRecord {
  return { id: row.id, userId: row.userId, provider: row.provider, label: row.label, status: row.status, envelope: JSON.parse(row.ciphertext) as CredentialEnvelope, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

async function audit(transaction: Transaction, row: CredentialRecord, action: string, requestId: string) {
  await transaction.insert(auditEvents).values({ userId: row.userId, action, targetType: "provider_credential", targetId: row.id, result: "success", requestId, metadata: { provider: row.provider, status: row.status } });
}

export class DatabaseCredentialRepository implements CredentialRepository {
  constructor(private readonly db: Database) {}

  async create(row: CredentialRecord, action: string, requestId: string) {
    return this.db.transaction(async (transaction) => {
      const [saved] = await transaction.insert(providerCredentials).values({ id: row.id, userId: row.userId, provider: row.provider, label: row.label, status: row.status, ciphertext: JSON.stringify(row.envelope), encryptedDataKey: row.envelope.wrappedDataKey, algorithmVersion: row.envelope.version, keyVersion: row.envelope.keyVersion, createdAt: row.createdAt, updatedAt: row.updatedAt }).returning();
      const record = fromRow(saved!);
      await audit(transaction, record, action, requestId);
      return record;
    });
  }

  async list(userId: string) { return (await this.db.select().from(providerCredentials).where(eq(providerCredentials.userId, userId))).map(fromRow); }
  async get(userId: string, id: string) { const [row] = await this.db.select().from(providerCredentials).where(and(eq(providerCredentials.userId, userId), eq(providerCredentials.id, id))).limit(1); return row ? fromRow(row) : null; }

  async mutate(userId: string, id: string, action: string, mutation: (row: CredentialRecord) => CredentialRecord | null, requestId: string) {
    return this.db.transaction(async (transaction) => {
      const [locked] = await transaction.select().from(providerCredentials).where(and(eq(providerCredentials.userId, userId), eq(providerCredentials.id, id))).limit(1).for("update");
      if (!locked) return null;
      const next = mutation(fromRow(locked));
      if (!next) return null;
      const [saved] = await transaction.update(providerCredentials).set({ label: next.label, status: next.status, ciphertext: JSON.stringify(next.envelope), encryptedDataKey: next.envelope.wrappedDataKey, algorithmVersion: next.envelope.version, keyVersion: next.envelope.keyVersion, updatedAt: next.updatedAt }).where(and(eq(providerCredentials.userId, userId), eq(providerCredentials.id, id))).returning();
      const record = fromRow(saved!);
      await audit(transaction, record, action, requestId);
      return record;
    });
  }

  async auditResolution(event: { userId: string; credentialId: string; provider: string; runId: string; result: "success" | "rejected"; reason?: string }) {
    await this.db.insert(auditEvents).values({ userId: event.userId, action: "credential.resolve", targetType: "provider_credential", targetId: event.credentialId, result: event.result, requestId: randomUUID(), metadata: { provider: event.provider, runId: event.runId, ...(event.reason ? { reason: event.reason } : {}) } });
  }
}
