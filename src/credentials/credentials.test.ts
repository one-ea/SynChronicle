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

  it("redacts API-key header variants in plain objects and Headers", () => {
    const value = redactSecrets({ "x-api-key": "a", "api-key": "b", "vendor-api-key": "c", authorization: "d", "proxy-authorization": "e", cookie: "f", "set-cookie": "g", headers: new Headers({ "x-api-key": "h" }) });
    expect(Object.values(value).every((entry) => typeof entry === "object" || entry === "[REDACTED]")).toBe(true);
    expect(JSON.stringify(value)).not.toMatch(/"[a-h]"/);
  });
});

class MemoryCredentials implements CredentialRepository {
  rows = new Map<string, CredentialRecord>();
  audits: string[] = [];
  resolutionAudits: Array<Record<string, unknown>> = [];
  async create(row: CredentialRecord, action: string) { this.rows.set(row.id, structuredClone(row)); this.audits.push(action); return row; }
  async list(userId: string) { return [...this.rows.values()].filter((row) => row.userId === userId); }
  async get(userId: string, id: string) { const row = this.rows.get(id); return row?.userId === userId ? structuredClone(row) : null; }
  async mutate(userId: string, id: string, action: string, mutation: (row: CredentialRecord) => CredentialRecord | null) { const row = await this.get(userId, id); if (!row) return null; const next = mutation(row); if (!next) return null; this.rows.set(id, structuredClone(next)); this.audits.push(action); return next; }
  async auditResolution(event: Record<string, unknown>) { this.resolutionAudits.push(structuredClone(event)); }
}

describe("CredentialService", () => {
  it("enforces provider-aware base URL hosts on create, replace, and resolve", async () => {
    const repository = new MemoryCredentials();
    const resolve = async () => [{ address: "93.184.216.34", family: 4 as const }];
    const service = new CredentialService(repository, keys, resolve);
    const userId = randomUUID();

    await expect(service.create(userId, { provider: "openai", apiKey: "secret", baseUrl: "https://api.anthropic.com" }, "req-1")).rejects.toMatchObject({ code: "CREDENTIAL_URL_UNSAFE" });
    const saved = await service.create(userId, { provider: "openai", apiKey: "secret", baseUrl: "https://api.openai.com/v1" }, "req-2");
    await expect(service.replace(userId, saved.id, { apiKey: "next", baseUrl: "https://api.example.com" }, "req-3")).rejects.toMatchObject({ code: "CREDENTIAL_URL_UNSAFE" });

    repository.rows.get(saved.id)!.envelope = encryptCredential(keys, JSON.stringify({ apiKey: "secret", baseUrl: "https://api.anthropic.com" }), { userId, credentialId: saved.id, provider: "openai" });
    await expect(service.resolve(userId, saved.id, { runId: "run-host-mismatch" })).rejects.toMatchObject({ code: "CREDENTIAL_URL_UNSAFE" });
  });

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
    await expect(service.resolve(userId, saved.id)).rejects.toMatchObject({ code: "CREDENTIAL_DISABLED" });
    await service.replace(userId, saved.id, { apiKey: "next-secret" }, "req-3");
    expect(await service.resolve(userId, saved.id)).toMatchObject({ apiKey: "next-secret" });
    await service.revoke(userId, saved.id, "req-4");
    await expect(service.replace(userId, saved.id, { apiKey: "again" }, "req-5")).rejects.toThrow("revoked");
    expect(repository.audits).toEqual(["credential.create", "credential.disable", "credential.replace", "credential.revoke"]);
  });

  it("audits successful and rejected resolution without secrets and fails closed on audit failure", async () => {
    const repository = new MemoryCredentials();
    const service = new CredentialService(repository, keys);
    const userId = randomUUID();
    const saved = await service.create(userId, { provider: "openai", apiKey: "audit-secret" }, "req-1");
    await service.resolve(userId, saved.id, { runId: "run-1" });
    await service.resolve(randomUUID(), saved.id, { runId: "run-2" });
    expect(repository.resolutionAudits).toEqual([
      expect.objectContaining({ credentialId: saved.id, provider: "openai", runId: "run-1", result: "success" }),
      expect.objectContaining({ credentialId: saved.id, runId: "run-2", result: "rejected", reason: "not_found" }),
    ]);
    expect(JSON.stringify(repository.resolutionAudits)).not.toContain("audit-secret");
    const auditFailure = vi.fn(async () => { throw new Error("audit unavailable"); });
    repository.auditResolution = auditFailure;
    await expect(service.resolve(userId, saved.id, { runId: "run-3" })).rejects.toThrow("audit unavailable");
    expect(auditFailure).toHaveBeenCalledOnce();
    expect(auditFailure).toHaveBeenCalledWith(expect.objectContaining({ result: "success", runId: "run-3" }));
  });

  it("classifies invalid payloads and unsafe URLs independently from audit failures", async () => {
    const repository = new MemoryCredentials();
    const service = new CredentialService(repository, keys, async () => [{ address: "127.0.0.1", family: 4 }]);
    const userId = randomUUID();
    const malformed = await service.create(userId, { provider: "openai", apiKey: "secret" }, "req-1");
    repository.rows.get(malformed.id)!.envelope = encryptCredential(keys, "not-json", { userId, credentialId: malformed.id, provider: "openai" });

    await expect(service.resolve(userId, malformed.id, { runId: "run-invalid" })).rejects.toBeInstanceOf(SyntaxError);
    expect(repository.resolutionAudits.at(-1)).toMatchObject({ result: "rejected", reason: "invalid_payload" });

    const unsafe = await service.create(userId, { provider: "openai", apiKey: "secret" }, "req-2");
    repository.rows.get(unsafe.id)!.envelope = encryptCredential(keys, JSON.stringify({ apiKey: "secret", baseUrl: "https://api.openai.com" }), { userId, credentialId: unsafe.id, provider: "openai" });
    await expect(service.resolve(userId, unsafe.id, { runId: "run-unsafe" })).rejects.toMatchObject({ code: "CREDENTIAL_URL_UNSAFE" });
    expect(repository.resolutionAudits.at(-1)).toMatchObject({ result: "rejected", reason: "credential_url_unsafe" });

    const auditCount = repository.resolutionAudits.length;
    repository.auditResolution = async () => { throw new Error("audit unavailable"); };
    await expect(service.resolve(userId, unsafe.id, { runId: "run-audit" })).rejects.toThrow("audit unavailable");
    expect(repository.resolutionAudits).toHaveLength(auditCount);
  });
});
