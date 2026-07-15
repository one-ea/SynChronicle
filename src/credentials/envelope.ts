import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface CredentialEnvelope {
  version: 1;
  algorithm: "aes-256-gcm";
  keyVersion: string;
  wrappedDataKey: string;
  wrapIv: string;
  wrapTag: string;
  ciphertext: string;
  dataIv: string;
  dataTag: string;
}

export interface CredentialAad { userId: string; credentialId: string; provider: string }
export interface MasterKeyRegistry { currentVersion: string; keys: ReadonlyMap<string, Uint8Array> }

export class CredentialCryptoError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = "CredentialCryptoError"; }
}

function aadBytes(aad: CredentialAad): Buffer {
  return Buffer.from(JSON.stringify([aad.userId, aad.credentialId, aad.provider]), "utf8");
}

function key(registry: MasterKeyRegistry, version: string): Buffer {
  const value = registry.keys.get(version);
  if (!value) throw new CredentialCryptoError(`master key version ${version} is unavailable`);
  if (value.byteLength !== 32) throw new CredentialCryptoError(`master key version ${version} must be 32 bytes`);
  return Buffer.from(value);
}

function encrypt(keyValue: Buffer, plaintext: Buffer, aad: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyValue, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

function decrypt(keyValue: Buffer, ciphertext: string, iv: string, tag: string, aad: Buffer): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", keyValue, Buffer.from(iv, "base64"));
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]);
}

export function encryptCredential(registry: MasterKeyRegistry, plaintext: string, aad: CredentialAad): CredentialEnvelope {
  const dataKey = randomBytes(32);
  const additionalData = aadBytes(aad);
  const data = encrypt(dataKey, Buffer.from(plaintext, "utf8"), additionalData);
  const wrapped = encrypt(key(registry, registry.currentVersion), dataKey, additionalData);
  dataKey.fill(0);
  return { version: 1, algorithm: "aes-256-gcm", keyVersion: registry.currentVersion, wrappedDataKey: wrapped.ciphertext, wrapIv: wrapped.iv, wrapTag: wrapped.tag, ciphertext: data.ciphertext, dataIv: data.iv, dataTag: data.tag };
}

export function decryptCredential(registry: MasterKeyRegistry, envelope: CredentialEnvelope, aad: CredentialAad): string {
  if (envelope.version !== 1 || envelope.algorithm !== "aes-256-gcm") throw new CredentialCryptoError("unsupported credential envelope version or algorithm");
  const additionalData = aadBytes(aad);
  let dataKey: Buffer | undefined;
  try {
    dataKey = decrypt(key(registry, envelope.keyVersion), envelope.wrappedDataKey, envelope.wrapIv, envelope.wrapTag, additionalData);
    return decrypt(dataKey, envelope.ciphertext, envelope.dataIv, envelope.dataTag, additionalData).toString("utf8");
  } catch (error) {
    if (error instanceof CredentialCryptoError) throw error;
    throw new CredentialCryptoError("credential authentication failed", { cause: error });
  } finally {
    dataKey?.fill(0);
  }
}

export function masterKeyRegistryFromEnvironment(value: string | undefined, currentVersion: string | undefined): MasterKeyRegistry {
  if (!value?.trim()) throw new CredentialCryptoError("PROJECT_CREDENTIAL_MASTER_KEYS is required");
  const keys = new Map<string, Buffer>();
  for (const entry of value.split(",")) {
    const separator = entry.indexOf(":");
    if (separator <= 0) throw new CredentialCryptoError("PROJECT_CREDENTIAL_MASTER_KEYS contains an invalid entry");
    const version = entry.slice(0, separator).trim();
    const decoded = Buffer.from(entry.slice(separator + 1).trim(), "base64");
    if (decoded.byteLength !== 32) throw new CredentialCryptoError(`master key version ${version} must decode to 32 bytes`);
    keys.set(version, decoded);
  }
  const selected = currentVersion?.trim();
  if (!selected) throw new CredentialCryptoError("PROJECT_CREDENTIAL_MASTER_KEY_VERSION is required");
  key({ currentVersion: selected, keys }, selected);
  return { currentVersion: selected, keys };
}
