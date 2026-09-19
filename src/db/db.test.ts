import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureSchema, openDatabase, parseDatabaseUrl } from "./sql.js";
import { SqlKV } from "./kv.js";
import { UsersDao } from "./users.js";
import { migrateFiles, verifyMigration } from "./migrate-files.js";

function sqliteUrl(dir: string): string { return `sqlite:${join(dir, "test.db")}`; }

describe("db platform", () => {
  it("parses database urls across dialects", () => {
    expect(parseDatabaseUrl("sqlite:data/x.db").dialect).toBe("sqlite");
    expect(parseDatabaseUrl("postgres://h/db").dialect).toBe("postgres");
    expect(parseDatabaseUrl("mysql://h/db").dialect).toBe("mysql");
    expect(() => parseDatabaseUrl("redis://x")).toThrow("DATABASE_URL");
  });

  it("creates schema idempotently and persists kv content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "p10-db-"));
    const db = await openDatabase(sqliteUrl(dir));
    try {
      await ensureSchema(db);
      await ensureSchema(db);
      const kv = new SqlKV(db);
      expect(await kv.get("bookshelf.json")).toBeNull();
      await kv.set("bookshelf.json", "{\"books\":[]}");
      await kv.set("bookshelf.json", "{\"books\":[1]}");
      expect(await kv.get("bookshelf.json")).toBe("{\"books\":[1]}");
      await kv.set("novel/meta/progress.json", "{}");
      expect(await kv.list("novel/")).toEqual(["novel/meta/progress.json"]);
      await kv.delete("bookshelf.json");
      expect(await kv.get("bookshelf.json")).toBeNull();
      expect(await kv.count()).toBe(1);
    } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
  });

  it("claims invite codes atomically and keeps quota on user sync", async () => {
    const dir = await mkdtemp(join(tmpdir(), "p10-users-"));
    const db = await openDatabase(sqliteUrl(dir));
    try {
      await ensureSchema(db);
      const users = new UsersDao(db);
      await users.createInvite("inv-1", 5, "admin", null);
      const first = await users.claimInvite("inv-1", "u-1", "now");
      const second = await users.claimInvite("inv-1", "u-2", "now");
      expect(first.ok).toBe(true);
      expect(first.grantedUsd).toBe(5);
      expect(second.ok).toBe(false);
      expect((await users.listInvites())[0]!.used_by).toBe("u-1");
      await users.upsert({ id: "u-1", name: "a", password_salt: "x", password_hash: "y", role: "writer", status: "active", quota_usd_remaining: 5, quota_usd_used: 0, created_at: "t", updated_at: "t" });
      expect((await users.byName("a"))!.quota_usd_remaining).toBe(5);
      expect(await users.count()).toBe(1);
    } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
  });

  it("migrates a v2 file workspace into the database idempotently and verifies", async () => {
    const root = await mkdtemp(join(tmpdir(), "p10-migrate-"));
    const output = join(root, "output");
    await mkdir(join(output, "novel", "meta"), { recursive: true });
    await writeFile(join(output, "users.json"), JSON.stringify({ users: [{ id: "u-9", name: "admin", role: "admin", salt: "a".repeat(16), hash: "b".repeat(64), createdAt: "t", disabled: false }], updatedAt: "t" }));
    await writeFile(join(output, "bookshelf.json"), JSON.stringify({ books: [{ id: "novel", title: "书", createdAt: "t", updatedAt: "t", ownerId: "u-9" }], activeId: "novel", updatedAt: "t" }));
    await writeFile(join(output, "novel", "meta", "progress.json"), JSON.stringify({ novel_name: "书", completed_chapters: [1, 2], total_word_count: 42 }));
    const dbUrl = sqliteUrl(root);
    const first = await migrateFiles(output, dbUrl);
    const second = await migrateFiles(output, dbUrl);
    expect(first.filesImported).toBe(2);
    expect(first.usersImported).toBe(1);
    expect(second.filesImported).toBe(0);
    expect(second.usersImported).toBe(0);
    expect(second.filesSkipped).toBe(2);
    const report = await verifyMigration(output, dbUrl);
    expect(report.ok).toBe(true);
    expect(report.books.db).toBe(1);
    expect(report.chapters.db).toBe(2);
    expect(report.words.db).toBe(42);
    await rm(root, { recursive: true, force: true });
  });
});
