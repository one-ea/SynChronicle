import { randomUUID } from "node:crypto";
import { decryptCredential, encryptCredential, type CredentialEnvelope, type MasterKeyRegistry } from "./envelope.js";

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
}

function metadata(row: CredentialRecord): CredentialMetadata {
  return { id: row.id, provider: row.provider, label: row.label, status: row.status, keyVersion: row.envelope.keyVersion, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export class CredentialService {
  constructor(private readonly repository: CredentialRepository, private readonly keys: MasterKeyRegistry) {}

  async create(userId: string, input: CredentialSecret & { provider: string; label?: string }, requestId: string): Promise<CredentialMetadata> {
    const id = randomUUID();
    const now = new Date();
    const envelope = encryptCredential(this.keys, JSON.stringify({ apiKey: input.apiKey, ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}) }), { userId, credentialId: id, provider: input.provider });
    return metadata(await this.repository.create({ id, userId, provider: input.provider, label: input.label?.trim() || input.provider, status: "active", envelope, createdAt: now, updatedAt: now }, "credential.create", requestId));
  }

  async list(userId: string): Promise<CredentialMetadata[]> { return (await this.repository.list(userId)).map(metadata); }

  async replace(userId: string, id: string, input: CredentialSecret, requestId: string): Promise<CredentialMetadata | null> {
    const row = await this.repository.mutate(userId, id, "credential.replace", (current) => {
      if (current.status === "revoked") throw new Error("credential is revoked");
      const envelope = encryptCredential(this.keys, JSON.stringify(input), { userId, credentialId: id, provider: current.provider });
      return { ...current, status: "active", envelope, updatedAt: new Date() };
    }, requestId);
    return row ? metadata(row) : null;
  }

  async disable(userId: string, id: string, requestId: string): Promise<CredentialMetadata | null> {
    const row = await this.repository.mutate(userId, id, "credential.disable", (current) => current.status === "revoked" ? null : { ...current, status: "disabled", updatedAt: new Date() }, requestId);
    return row ? metadata(row) : null;
  }

  async revoke(userId: string, id: string, requestId: string): Promise<CredentialMetadata | null> {
    const row = await this.repository.mutate(userId, id, "credential.revoke", (current) => ({ ...current, status: "revoked", updatedAt: new Date() }), requestId);
    return row ? metadata(row) : null;
  }

  async resolve(userId: string, id: string): Promise<(CredentialSecret & { provider: string }) | null> {
    const row = await this.repository.get(userId, id);
    if (!row || row.status !== "active") return null;
    const plaintext = decryptCredential(this.keys, row.envelope, { userId, credentialId: id, provider: row.provider });
    try { return { provider: row.provider, ...JSON.parse(plaintext) as CredentialSecret }; }
    finally { Buffer.from(plaintext).fill(0); }
  }
}
