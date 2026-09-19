import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureSchema, openDatabase } from "../db/sql.js";
import { ChannelsDao, QuotaDao } from "./dao.js";
import { PlatformCrypto, maskKey } from "./crypto.js";
import { UsersDao } from "../db/users.js";

const KEY = "a".repeat(64);

describe("platform crypto", () => {
  it("round-trips secrets and rejects tampering", () => {
    const crypto = PlatformCrypto.fromHex(KEY);
    const secret = crypto.encrypt("sk-live-abcdef123456");
    expect(crypto.decrypt(secret)).toBe("sk-live-abcdef123456");
    const tampered = { ...secret, ct: Buffer.from("tampered!").toString("base64") };
    expect(() => crypto.decrypt(tampered)).toThrow();
    expect(maskKey("sk-live-abcdef123456")).toBe("sk-****3456");
    expect(maskKey("short")).toBe("****");
  });

  it("rotates master key across stored channel secrets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "p10-rotate-"));
    const db = await openDatabase(`sqlite:${join(dir, "t.db")}`);
    await ensureSchema(db);
    const dao = new ChannelsDao(db);
    const oldCrypto = await PlatformCrypto.loadOrInit(db);
    const secret = oldCrypto.encrypt("sk-old");
    await dao.create({ id: "ch-1", owner_id: null, name: "n", provider: "openai", base_url: "https://x", api_key_ct: secret.ct, api_key_iv: secret.iv, api_key_tag: secret.tag, models: "gpt", weight: 1, status: "active", created_at: "t" });
    const next = PlatformCrypto.fromHex("b".repeat(64));
    const count = await PlatformCrypto.rotate(oldCrypto, next, { list: async () => (await dao.listAll()).map((row) => ({ id: row.id, ct: row.api_key_ct, iv: row.api_key_iv, tag: row.api_key_tag })), save: (id, s) => dao.saveSecret(id, s.ct, s.iv, s.tag) });
    expect(count).toBe(1);
    const rotated = await dao.get("ch-1");
    expect(next.decrypt({ ct: rotated!.api_key_ct, iv: rotated!.api_key_iv, tag: rotated!.api_key_tag })).toBe("sk-old");
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
});

describe("channels and quota", () => {
  it("merges own and granted admin-pool channels per user", async () => {
    const dir = await mkdtemp(join(tmpdir(), "p10-channels-"));
    const db = await openDatabase(`sqlite:${join(dir, "t.db")}`);
    await ensureSchema(db);
    const channels = new ChannelsDao(db);
    const base = { provider: "openai", base_url: "https://x", api_key_ct: "c", api_key_iv: "i", api_key_tag: "g", models: "m1", weight: 1, status: "active", created_at: "t" } as const;
    await channels.create({ ...base, id: "own", owner_id: "u-1", name: "自有" });
    await channels.create({ ...base, id: "pool", owner_id: null, name: "池" });
    await channels.create({ ...base, id: "off", owner_id: null, name: "停用", status: "disabled" });
    expect((await channels.effective("u-1")).map((row) => row.id)).toEqual(["own"]);
    await channels.grant("pool", "u-1", "now");
    expect((await channels.effective("u-1")).map((row) => row.id)).toEqual(["own", "pool"]);
    await channels.revoke("pool", "u-1");
    expect((await channels.effective("u-1")).map((row) => row.id)).toEqual(["own"]);
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("settles quota atomically without negative balance and redeems once", async () => {
    const dir = await mkdtemp(join(tmpdir(), "p10-quota-"));
    const db = await openDatabase(`sqlite:${join(dir, "t.db")}`);
    await ensureSchema(db);
    const users = new UsersDao(db);
    const quota = new QuotaDao(db);
    await users.upsert({ id: "u-1", name: "a", password_salt: "x", password_hash: "y", role: "writer", status: "active", quota_usd_remaining: 1, quota_usd_used: 0, created_at: "t", updated_at: "t" });
    const entry = { user_id: "u-1", book_id: null, agent: "writer", tokens_in: 100, tokens_out: 50, cost_usd: 0.4, created_at: "t" };
    expect(await quota.settle("u-1", entry)).toBe(true);
    expect(await quota.settle("u-1", entry)).toBe(true);
    const afterSettle = await quota.balance("u-1");
    expect(afterSettle.remaining).toBeCloseTo(0.2, 8);
    expect(afterSettle.used).toBeCloseTo(0.8, 8);
    expect((await quota.ledger("u-1")).length).toBe(2);
    await quota.createRechargeCode("rc-1", 5, "admin");
    expect(await quota.redeem("rc-1", "u-1", "now")).toMatchObject({ ok: true, amountUsd: 5 });
    expect(await quota.redeem("rc-1", "u-1", "now")).toMatchObject({ ok: false });
    expect((await quota.balance("u-1")).remaining).toBeCloseTo(5.2, 6);
    expect((await quota.dailySummary("u-1")).length).toBe(1);
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
});
