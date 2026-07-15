import { randomUUID } from "node:crypto";
import { decryptCredential, encryptCredential, type CredentialEnvelope, type MasterKeyRegistry } from "./envelope.js";
import { validateProviderUrl, type DnsResolver } from "../providers/urlPolicy.js";

export type CredentialStatus = "active" | "disabled" | "revoked" | "invalid";
export interface CredentialSecret { apiKey: string; baseUrl?: string }
export interface CredentialRecord {
  id: string;
  userId: string;
  provider: string;
  label: string;
  status: CredentialStatus;
  envelope: CredentialEnvelope;
  createdAt: Date;
  updatedAt: Date;
}
export interface CredentialMetadata { id: string; provider: string; label: string; status: CredentialStatus; keyVersion: string; createdAt: Date; updatedAt: Date }

export interface CredentialRepository {
  create(row: CredentialRecord, action: string, requestId: string): Promise<CredentialRecord>;
  list(userId: string): Promise<CredentialRecord[]>;
  get(userId: string, id: string): Promise<CredentialRecord | null>;
  mutate(userId: string, id: string, action: string, mutation: (row: CredentialRecord) => CredentialRecord | null, requestId: string): Promise<CredentialRecord | null>;
  auditResolution?(event: { userId: string; credentialId: string; provider: string; runId: string; result: "success" | "rejected"; reason?: string }): Promise<void>;
}

export class CredentialServiceError extends Error {
  constructor(readonly code: "CREDENTIAL_REVOKED" | "CREDENTIAL_DISABLED" | "CREDENTIAL_INVALID" | "CREDENTIAL_NOT_FOUND" | "CREDENTIAL_URL_UNSAFE", message: string, readonly statusCode: 400 | 404 | 409) { super(message); this.name = "CredentialServiceError"; }
}

function metadata(row: CredentialRecord): CredentialMetadata {
  return { id: row.id, provider: row.provider, label: row.label, status: row.status, keyVersion: row.envelope.keyVersion, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export class CredentialService {
  constructor(private readonly repository: CredentialRepository, private readonly keys: MasterKeyRegistry, private readonly resolveDns?: DnsResolver) {}

  async create(userId: string, input: CredentialSecret & { provider: string; label?: string }, requestId: string): Promise<CredentialMetadata> {
    await this.validateBaseUrl(input.baseUrl);
    const id = randomUUID();
    const now = new Date();
    const envelope = encryptCredential(this.keys, JSON.stringify({ apiKey: input.apiKey, ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}) }), { userId, credentialId: id, provider: input.provider });
    return metadata(await this.repository.create({ id, userId, provider: input.provider, label: input.label?.trim() || input.provider, status: "active", envelope, createdAt: now, updatedAt: now }, "credential.create", requestId));
  }

  async list(userId: string): Promise<CredentialMetadata[]> { return (await this.repository.list(userId)).map(metadata); }

  async replace(userId: string, id: string, input: CredentialSecret, requestId: string): Promise<CredentialMetadata | null> {
    await this.validateBaseUrl(input.baseUrl);
    const row = await this.repository.mutate(userId, id, "credential.replace", (current) => {
      if (current.status === "revoked") throw new CredentialServiceError("CREDENTIAL_REVOKED", "Credential is revoked", 409);
      const envelope = encryptCredential(this.keys, JSON.stringify(input), { userId, credentialId: id, provider: current.provider });
      return { ...current, status: "active", envelope, updatedAt: new Date() };
    }, requestId);
    return row ? metadata(row) : null;
  }

  async disable(userId: string, id: string, requestId: string): Promise<CredentialMetadata | null> {
    const row = await this.repository.mutate(userId, id, "credential.disable", (current) => { if (current.status === "revoked") throw new CredentialServiceError("CREDENTIAL_REVOKED", "Credential is revoked", 409); return { ...current, status: "disabled", updatedAt: new Date() }; }, requestId);
    return row ? metadata(row) : null;
  }

  async revoke(userId: string, id: string, requestId: string): Promise<CredentialMetadata | null> {
    const row = await this.repository.mutate(userId, id, "credential.revoke", (current) => ({ ...current, status: "revoked", updatedAt: new Date() }), requestId);
    return row ? metadata(row) : null;
  }

  async resolve(userId: string, id: string, context: { runId: string } = { runId: "unscoped" }): Promise<(CredentialSecret & { provider: string }) | null> {
    const row = await this.repository.get(userId, id);
    if (!row) { await this.auditResolution({ userId, credentialId: id, provider: "unknown", runId: context.runId, result: "rejected", reason: "not_found" }); return null; }
    if (row.status !== "active") { await this.auditResolution({ userId, credentialId: id, provider: row.provider, runId: context.runId, result: "rejected", reason: row.status }); const code = row.status === "revoked" ? "CREDENTIAL_REVOKED" : row.status === "disabled" ? "CREDENTIAL_DISABLED" : "CREDENTIAL_INVALID"; throw new CredentialServiceError(code, `Credential is ${row.status}`, 409); }
    let plaintext: string | undefined;
    try {
      plaintext = decryptCredential(this.keys, row.envelope, { userId, credentialId: id, provider: row.provider });
      const secret = { provider: row.provider, ...JSON.parse(plaintext) as CredentialSecret };
      await this.validateBaseUrl(secret.baseUrl);
      await this.auditResolution({ userId, credentialId: id, provider: row.provider, runId: context.runId, result: "success" });
      return secret;
    } catch (error) {
      await this.auditResolution({ userId, credentialId: id, provider: row.provider, runId: context.runId, result: "rejected", reason: error instanceof CredentialServiceError ? error.code.toLowerCase() : "decrypt_failed" });
      throw error;
    } finally {
      if (plaintext) Buffer.from(plaintext).fill(0);
    }
  }

  private async validateBaseUrl(baseUrl?: string) {
    if (!baseUrl) return;
    try { await validateProviderUrl(baseUrl, this.resolveDns); }
    catch (error) { throw new CredentialServiceError("CREDENTIAL_URL_UNSAFE", "Credential base URL is unsafe", 400); }
  }
  private async auditResolution(event: { userId: string; credentialId: string; provider: string; runId: string; result: "success" | "rejected"; reason?: string }) { await this.repository.auditResolution?.(event); }
}
