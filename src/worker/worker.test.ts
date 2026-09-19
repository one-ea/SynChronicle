import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { scanSafety } from "../diag/safety.js";
import { PublishedEntrySchema, titleHue } from "../domain/publish.js";
import { ensureSchema, type SqlDatabase } from "../db/sql-core.js";
import { UsersDao } from "../db/users.js";
import { ChannelsDao, QuotaDao, AuditDao, ReportsDao } from "../platform/dao.js";
import { WorkerCrypto, issueToken, verifyToken, maskKey } from "../../worker/crypto.js";

/** better-sqlite3 包装成 SqlDatabase：与 D1 同为 sqlite 方言，验证真实 SQL 语义。 */
function sqliteDb(): SqlDatabase {
  const db = new Database(":memory:");
  return {
    dialect: "sqlite",
    async run(sql, params = []) { db.prepare(sql).run(...params); },
    async get<T>(sql: string, params: unknown[] = []) { return (db.prepare(sql).get(...params) ?? null) as T | null; },
    async all<T>(sql: string, params: unknown[] = []) { return db.prepare(sql).all(...params) as T[]; },
    async close() { db.close(); },
  };
}

describe("worker portable core", () => {
  it("ensureSchema DDL 可重复执行", async () => {
    const db = sqliteDb();
    await ensureSchema(db);
    await ensureSchema(db);
    await db.run("INSERT INTO users (id, name, password_salt, password_hash, role, status, created_at, updated_at) VALUES ('u1', 'a', 's', 'h', 'admin', 'active', 't', 't')");
    expect(await db.get<{ id: string }>("SELECT id FROM users WHERE id = 'u1'")).not.toBeNull();
    await db.close();
  });

  it("DAO 基本语句在 sqlite 上闭环", async () => {
    const db = sqliteDb();
    await ensureSchema(db);
    const users = new UsersDao(db);
    await users.upsert({ id: "u1", name: "admin", password_salt: "s", password_hash: "h", role: "admin", status: "active", quota_usd_remaining: 5, quota_usd_used: 0, created_at: "t", updated_at: "t" });
    expect((await users.byName("admin"))?.id).toBe("u1");
    await users.createInvite("inv-1", 3, "u1", null);
    const claim = await users.claimInvite("inv-1", "u1", "t");
    expect(claim.ok).toBe(true);
    expect(claim.grantedUsd).toBe(3);
    const channels = new ChannelsDao(db);
    await channels.create({ id: "c1", owner_id: null, name: "池", provider: "openai", base_url: "https://x", api_key_ct: "ct", api_key_iv: "iv", api_key_tag: "tag", models: '["gpt-4o"]', weight: 1, status: "active", created_at: "t" });
    await channels.grant("c1", "u1", "t");
    expect((await channels.listGrantedIds("u1")).includes("c1")).toBe(true);
    expect((await channels.effective("u1")).map((row) => row.id)).toContain("c1");
    const quota = new QuotaDao(db);
    await quota.createRechargeCode("rch-1", 2, "u1");
    expect((await quota.redeem("rch-1", "u1", "t")).ok).toBe(true);
    expect((await quota.redeem("rch-1", "u1", "t")).ok).toBe(false);
    await quota.settle("u1", { user_id: "u1", book_id: null, agent: "writer", tokens_in: 10, tokens_out: 5, cost_usd: 0.5, created_at: "t" });
    expect((await quota.balance("u1")).used).toBeGreaterThanOrEqual(0);
    const audit = new AuditDao(db);
    await audit.log("u1", "publish", "book:x", { visibility: "public" });
    expect(await audit.list()).toHaveLength(1);
    const reports = new ReportsDao(db);
    await reports.create("x", "违规");
    expect(await reports.list("open")).toHaveLength(1);
    expect(await reports.handle(1, "u1", "takedown")).toBe(true);
    await db.close();
  });

  it("WorkerCrypto 产物可被同密钥解密且拒绝篡改", async () => {
    const hex = "a".repeat(64);
    const box = WorkerCrypto.fromHex(hex);
    const secret = await box.encrypt("sk-test-1234567890");
    expect(await box.decrypt(secret)).toBe("sk-test-1234567890");
    const tampered = { ...secret, ct: secret.ct.slice(0, -2) + (secret.ct.endsWith("AA") ? "BB" : "AA") };
    await expect(box.decrypt(tampered)).rejects.toThrow();
    expect(maskKey("sk-test-1234567890")).toBe("sk-****7890");
  });

  it("会话令牌签发与校验闭环", async () => {
    const token = await issueToken("u1", "secret", 1000);
    expect((await verifyToken(token, "secret", 2000))?.uid).toBe("u1");
    expect(await verifyToken(token, "wrong", 2000)).toBeNull();
    expect(await verifyToken(token, "secret", 7 * 24 * 3600 + 2000)).toBeNull();
  });

  it("安全扫描与发布条目 schema 复用主线", () => {
    expect(scanSafety("正常内容").clean).toBe(true);
    expect(scanSafety("写下了自杀方法。").clean).toBe(false);
    const entry = PublishedEntrySchema.parse({ id: "x", title: "书", hue: titleHue("书"), publishedAt: "t", updatedAt: "t" });
    expect(entry.aigcLabel).toBe(true);
  });
});
