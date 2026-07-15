import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../db/client.js";
import { providerCredentials, users } from "../db/schema/index.js";
import { migrateDatabase } from "../db/migrate.js";
import { DatabaseCredentialRepository } from "./database.js";
import { CredentialCryptoError, type MasterKeyRegistry } from "./envelope.js";
import { CredentialService } from "./service.js";
import { credentialScopedModel } from "../providers/scoped.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const conditional = databaseUrl ? describe : describe.skip;

conditional("CredentialService PostgreSQL", () => {
  it("isolates tenants, serializes replace/revoke, rejects AAD tampering, and never stores plaintext", async () => {
    await migrateDatabase(databaseUrl!);
    const db = createDatabase(databaseUrl!);
    const keys: MasterKeyRegistry = { currentVersion: "v1", keys: new Map([["v1", randomBytes(32)]]) };
    const service = new CredentialService(new DatabaseCredentialRepository(db), keys);
    const alice = randomUUID(), bob = randomUUID();
    await db.insert(users).values([{ id: alice, username: `alice-${alice}`, passwordHash: "hash" }, { id: bob, username: `bob-${bob}`, passwordHash: "hash" }]);
    const saved = await service.create(alice, { provider: "openai", apiKey: "postgres-secret", label: "Primary" }, randomUUID());
    const [stored] = await db.select().from(providerCredentials).where(eq(providerCredentials.id, saved.id));
    expect(JSON.stringify(stored)).not.toContain("postgres-secret");
    expect(await service.resolve(bob, saved.id)).toBeNull();
    let released = false;
    const model = credentialScopedModel("openai", "gpt-5", saved.id, {}, async (credentialId, provider) => {
      const secret = await service.resolve(alice, credentialId);
      if (!secret || secret.provider !== provider) throw new Error("credential unavailable");
      return { apiKey: secret.apiKey, release() { secret.apiKey = ""; released = true; } };
    }, (() => ({ provider: "openai", modelId: "gpt-5", doGenerate: async () => ({ content: [], finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0 }, warnings: [] }) })) as never);
    await (model as unknown as { doGenerate(input: unknown): Promise<unknown> }).doGenerate({});
    expect(released).toBe(true);

    await Promise.allSettled([
      service.replace(alice, saved.id, { apiKey: "rotated-secret" }, randomUUID()),
      service.revoke(alice, saved.id, randomUUID()),
    ]);
    expect((await service.list(alice)).find(({ id }) => id === saved.id)?.status).toBe("revoked");

    const tampered = await service.create(alice, { provider: "openai", apiKey: "aad-secret" }, randomUUID());
    await db.update(providerCredentials).set({ provider: "anthropic" }).where(eq(providerCredentials.id, tampered.id));
    await expect(service.resolve(alice, tampered.id)).rejects.toBeInstanceOf(CredentialCryptoError);
    await db.$client.end();
  });
});
