import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { SqlDatabase } from "../db/sql.js";
import { SqlKV } from "../db/kv.js";

/** P10-B 信封加密：MASTER_KEY(AES-256-GCM) 加密渠道密钥，商用缺失拒启，自用自动生成。 */

const KEY_PATH = "platform/.master_key";

export interface EncryptedSecret { ct: string; iv: string; tag: string; }
export interface SecretKeeper { list(): Promise<Array<{ id: string } & EncryptedSecret>>; save(id: string, secret: EncryptedSecret): Promise<void>; }

export class PlatformCrypto {
  private constructor(private readonly key: Buffer) {}

  static fromEnv(): PlatformCrypto {
    const raw = process.env.MASTER_KEY ?? "";
    if (!/^[0-9a-f]{64}$/.test(raw)) throw new Error("商用模式要求 MASTER_KEY 为 64 位 hex（32 字节），请生成：openssl rand -hex 32");
    return PlatformCrypto.fromHex(raw);
  }

  /** 测试与轮换入口：以明确指定的 hex 主密钥构造。 */
  static fromHex(hex: string): PlatformCrypto {
    if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("主密钥必须是 64 位 hex");
    return new PlatformCrypto(Buffer.from(hex, "hex"));
  }

  static async loadOrInit(db: SqlDatabase): Promise<PlatformCrypto> {
    const kv = new SqlKV(db);
    const existing = (await kv.get(KEY_PATH)) ?? "";
    if (/^[0-9a-f]{64}$/.test(existing)) return new PlatformCrypto(Buffer.from(existing, "hex"));
    const generated = randomBytes(32).toString("hex");
    await kv.set(KEY_PATH, generated);
    return new PlatformCrypto(Buffer.from(generated, "hex"));
  }

  encrypt(plain: string): EncryptedSecret {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return { ct: ct.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
  }

  decrypt(secret: EncryptedSecret): string {
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(secret.iv, "base64"));
    decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(secret.ct, "base64")), decipher.final()]).toString("utf8");
  }

  /** 密钥轮换：旧实例解密、新实例重加密。返回处理条数；旧密钥错误时抛错。 */
  static async rotate(oldCrypto: PlatformCrypto, next: PlatformCrypto, keeper: SecretKeeper): Promise<number> {
    let count = 0;
    for (const row of await keeper.list()) {
      await keeper.save(row.id, next.encrypt(oldCrypto.decrypt({ ct: row.ct, iv: row.iv, tag: row.tag })));
      count += 1;
    }
    return count;
  }
}

export function maskKey(plain: string): string {
  if (plain.length <= 8) return "****";
  return `${plain.slice(0, 3)}****${plain.slice(-4)}`;
}
