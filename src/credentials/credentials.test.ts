import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CredentialCryptoError, decryptCredential, encryptCredential, type MasterKeyRegistry } from "./envelope.js";
import { redactSecrets } from "./redactor.js";
import { CredentialService, type CredentialRecord, type CredentialRepository } from "./service.js";

const keys: MasterKeyRegistry = { currentVersion: "v2", keys: new Map([["v1", randomBytes(32)], ["v2", randomBytes(32)]]) };
const aad = { userId: randomUUID(), credentialId: randomUUID(), provider: "openrouter" };

describe("credential envelope", () => {
  it("uses a random data key and decrypts with the recorded master-key version", () => {
    const first = encryptCredential(keys, "secret-value", aad);
    const second = encryptCredential(keys, "secret-value", aad);
    expect(first).not.toEqual(second);
    expect(first.keyVersion).toBe("v2");
    expect(decryptCredential(keys, first, aad)).toBe("secret-value");
    expect(JSON.stringify(first)).not.toContain("secret-value");
  });

  it("rejects AAD tampering and missing key versions with explicit errors", () => {
    const envelope = encryptCredential(keys, "secret-value", aad);
    expect(() => decryptCredential(keys, envelope, { ...aad, provider: "openai" })).toThrow(CredentialCryptoError);
    expect(() => decryptCredential({ currentVersion: "v2", keys: new Map([["v1", randomBytes(32)]]) }, envelope, aad)).toThrow("master key version v2 is unavailable");
  });
});

describe("recursive secret redaction", () => {
  it("redacts nested objects, arrays, headers, URL queries, and Error causes", () => {
    const error = new Error("request failed: secret-value", { cause: { apiKey: "secret-value" } });
    const value = redactSecrets({ authorization: "Bearer secret-value", nested: [{ token: "secret-value", url: "https://example.test/path?api_key=secret-value&ok=1" }], headers: new Headers({ authorization: "secret-value", "x-ok": "yes" }), error });
    expect(JSON.stringify(value)).not.toContain("secret-value");
    expect(value).toMatchObject({ authorization: "[REDACTED]", nested: [{ token: "[REDACTED]" }] });
  });
});

class MemoryCredentials implements CredentialRepository {
  rows = new Map<string, CredentialRecord>();
  audits: string[] = [];
  async create(row: CredentialRecord, action: string) { this.rows.set(row.id, structuredClone(row)); this.audits.push(action); return row; }
  async list(userId: string) { return [...this.rows.values()].filter((row) => row.userId === userId); }
  async get(userId: string, id: string) { const row = this.rows.get(id); return row?.userId === userId ? structuredClone(row) : null; }
  async mutate(userId: string, id: string, action: string, mutation: (row: CredentialRecord) => CredentialRecord | null) { const row = await this.get(userId, id); if (!row) return null; const next = mutation(row); if (!next) return null; this.rows.set(id, structuredClone(next)); this.audits.push(action); return next; }
}

describe("CredentialService", () => {
  it("stores ciphertext, lists metadata, replaces with a fresh data key, and isolates tenants", async () => {
    const repository = new MemoryCredentials();
    const service = new CredentialService(repository, keys);
    const userId = randomUUID();
    const saved = await service.create(userId, { provider: "openrouter", apiKey: "secret-value", label: "Primary" }, "req-1");
    const before = repository.rows.get(saved.id)!;
    expect(JSON.stringify(before)).not.toContain("secret-value");
    expect(await service.resolve(userId, saved.id)).toMatchObject({ apiKey: "secret-value" });
    expect(JSON.stringify(await service.list(userId))).not.toContain("ciphertext");
    expect(await service.resolve(randomUUID(), saved.id)).toBeNull();

    await service.replace(userId, saved.id, { apiKey: "next-secret" }, "req-2");
    expect(repository.rows.get(saved.id)?.envelope.wrappedDataKey).not.toBe(before.envelope.wrappedDataKey);
    expect(await service.resolve(userId, saved.id)).toMatchObject({ apiKey: "next-secret" });
  });

  it("enforces disable and revoke state transitions", async () => {
    const repository = new MemoryCredentials();
    const service = new CredentialService(repository, keys);
    const userId = randomUUID();
    const saved = await service.create(userId, { provider: "openai", apiKey: "secret-value" }, "req-1");
    await service.disable(userId, saved.id, "req-2");
    expect(await service.resolve(userId, saved.id)).toBeNull();
    await service.replace(userId, saved.id, { apiKey: "next-secret" }, "req-3");
    expect(await service.resolve(userId, saved.id)).toMatchObject({ apiKey: "next-secret" });
    await service.revoke(userId, saved.id, "req-4");
    await expect(service.replace(userId, saved.id, { apiKey: "again" }, "req-5")).rejects.toThrow("revoked");
    expect(repository.audits).toEqual(["credential.create", "credential.disable", "credential.replace", "credential.revoke"]);
  });
});
