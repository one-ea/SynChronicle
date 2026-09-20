/**
 * Web Crypto 版信封加密：与 Node 版 PlatformCrypto 产物格式完全兼容。
 * AES-256-GCM，密文 base64、IV 12 字节 base64、tag 16 字节 base64。
 */

export interface EncryptedSecret { ct: string; iv: string; tag: string }

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function importKey(hexKey: string): Promise<CryptoKey> {
  if (!/^[0-9a-f]{64}$/.test(hexKey)) throw new Error("MASTER_KEY 必须是 64 位 hex");
  const raw = new Uint8Array(new ArrayBuffer(32));
  for (let index = 0; index < 32; index += 1) raw[index] = Number.parseInt(hexKey.slice(index * 2, index * 2 + 2), 16);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]) as Promise<CryptoKey>;
}

export class WorkerCrypto {
  private constructor(private readonly key: Promise<CryptoKey>) {}

  static fromHex(hex: string): WorkerCrypto {
    return new WorkerCrypto(importKey(hex));
  }

  async encrypt(plain: string): Promise<EncryptedSecret> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const buffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await this.key, encoder.encode(plain));
    return { ct: toBase64(new Uint8Array(buffer)), iv: toBase64(iv), tag: "" };
  }

  async decrypt(secret: EncryptedSecret): Promise<string> {
    const buffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(secret.iv) }, await this.key, fromBase64(secret.ct));
    return new TextDecoder().decode(buffer);
  }
}

export function maskKey(plain: string): string {
  if (plain.length <= 8) return "****";
  return `${plain.slice(0, 3)}****${plain.slice(-4)}`;
}

/** HMAC-SHA256 会话令牌：payload base64url + hex 签名，与 Node 版 issueToken 语义一致。 */
export async function issueToken(uid: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const payload = toBase64(encoder.encode(JSON.stringify({ uid, exp: nowSeconds + 7 * 24 * 3600 }))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${payload}.${await hmacHex(payload, secret)}`;
}

export async function verifyToken(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<{ uid: string; exp: number } | null> {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = await hmacHex(payload, secret);
  if (signature.length !== expected.length) return null;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) diff |= signature.charCodeAt(index) ^ expected.charCodeAt(index);
  if (diff !== 0) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const value = JSON.parse(new TextDecoder().decode(fromBase64(padded))) as { uid?: unknown; exp?: unknown };
    if (typeof value.uid !== "string" || typeof value.exp !== "number" || value.exp <= nowSeconds) return null;
    return { uid: value.uid, exp: value.exp };
  } catch { return null; }
}

async function hmacHex(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function toHex(bytes: Uint8Array): string { return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }

/** PBKDF2-SHA256（100k 轮）密码哈希：Worker 无 scrypt，格式 salt$hash hex。 */
export async function pbkdf2Hex(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 100_000 }, key, 512);
  return toHex(new Uint8Array(bits));
}
