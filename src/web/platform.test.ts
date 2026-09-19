import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startWebServer } from "../web/server.js";
import { openDatabase, ensureSchema } from "../db/sql.js";
import { UsersDao } from "../db/users.js";

function seed(dir: string, mode: "selfhost" | "commercial"): Promise<string> {
  const configPath = join(dir, "config.json");
  return writeFile(configPath, JSON.stringify({ provider: "deepseek", model: "deepseek-chat", providers: { deepseek: { base_url: "https://api.deepseek.com/v1" } }, output_dir: join(dir, "output", "novel") })).then(() => configPath).then(async (path) => {
    const db = await openDatabase(`sqlite:${join(dir, "test.db")}`);
    await ensureSchema(db);
    await db.close();
    return path;
  }).then((path) => { void mode; return path; });
}

describe("p10-a platform registration", () => {
  it("closes registration in selfhost mode and reports shell features", async () => {
    const dir = await mkdtemp(join(tmpdir(), "p10-reg-self-"));
    const configPath = await seed(dir, "selfhost");
    const handle = await startWebServer({ port: 0, configPath, storage: "db", dbUrl: `sqlite:${join(dir, "test.db")}`, mode: "selfhost" });
    try {
      const root = `http://127.0.0.1:${handle.port}`;
      const headers = { "content-type": "application/json", "x-requested-with": "fetch" };
      const shell = await (await fetch(`${root}/api/shell`)).json();
      expect(shell).toMatchObject({ mode: "selfhost", storage: "db", features: { register: false } });
      const register = await fetch(`${root}/api/auth/register`, { method: "POST", headers, body: JSON.stringify({ name: "someone", password: "long-password", inviteCode: "inv-x" }) });
      expect(register.status).toBe(403);
    } finally { await handle.close(); await rm(dir, { recursive: true, force: true }); }
  });

  it("registers writers via invite codes with granted quota in commercial db mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "p10-reg-comm-"));
    const configPath = await seed(dir, "commercial");
    const dbUrl = `sqlite:${join(dir, "test.db")}`;
    const handle = await startWebServer({ port: 0, configPath, storage: "db", dbUrl, mode: "commercial" });
    try {
      const root = `http://127.0.0.1:${handle.port}`;
      const headers = { "content-type": "application/json", "x-requested-with": "fetch" };
      await fetch(`${root}/api/auth/setup`, { method: "POST", headers, body: JSON.stringify({ name: "admin", password: "test-password" }) });
      const adminLogin = await fetch(`${root}/api/auth/login`, { method: "POST", headers, body: JSON.stringify({ name: "admin", password: "test-password" }) });
      const adminCookie = adminLogin.headers.get("set-cookie")!.split(";")[0];
      const adminHeaders = { ...headers, cookie: adminCookie };

      const invites: any = await (await fetch(`${root}/api/admin/invite-codes`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ count: 2, grantedUsd: 3.5 }) })).json();
      expect(invites.codes).toHaveLength(2);

      const missing = await fetch(`${root}/api/auth/register`, { method: "POST", headers, body: JSON.stringify({ name: "writer1", password: "writer-password", inviteCode: "inv-missing" }) });
      expect(missing.status).toBe(400);
      const created = await fetch(`${root}/api/auth/register`, { method: "POST", headers, body: JSON.stringify({ name: "writer1", password: "writer-password", inviteCode: invites.codes[0] }) });
      expect(created.status).toBe(201);
      expect(await created.json()).toMatchObject({ created: true, grantedUsd: 3.5 });

      const reuse = await fetch(`${root}/api/auth/register`, { method: "POST", headers, body: JSON.stringify({ name: "writer2", password: "writer-password", inviteCode: invites.codes[0] }) });
      expect(reuse.status).toBe(400);
      const login = await fetch(`${root}/api/auth/login`, { method: "POST", headers, body: JSON.stringify({ name: "writer1", password: "writer-password" }) });
      expect(login.status).toBe(200);

      const db = await openDatabase(dbUrl);
      await ensureSchema(db);
      const dao = new UsersDao(db);
      const row = await dao.byName("writer1");
      expect(row?.quota_usd_remaining).toBe(3.5);
      expect(row?.role).toBe("writer");
      const list: any = await (await fetch(`${root}/api/admin/invite-codes`, { headers: adminHeaders })).json();
      expect(list.invites.find((invite: { code: string }) => invite.code === invites.codes[0]).used_by).toBeTruthy();
      await db.close();

      const writerHeaders = { ...headers, cookie: login.headers.get("set-cookie")!.split(";")[0] };
      const forbidden = await fetch(`${root}/api/admin/invite-codes`, { method: "POST", headers: writerHeaders, body: JSON.stringify({ count: 1 }) });
      expect(forbidden.status).toBe(403);
    } finally { await handle.close(); await rm(dir, { recursive: true, force: true }); }
  });

  it("serves books through the database kv backend with legacy auth flows intact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "p10-db-flow-"));
    const configPath = await seed(dir, "selfhost");
    const handle = await startWebServer({ port: 0, configPath, storage: "db", dbUrl: `sqlite:${join(dir, "test.db")}` });
    try {
      const root = `http://127.0.0.1:${handle.port}`;
      const headers = { "content-type": "application/json", "x-requested-with": "fetch" };
      const created = await fetch(`${root}/api/auth/setup`, { method: "POST", headers, body: JSON.stringify({ name: "admin", password: "test-password" }) });
      expect(created.status).toBe(201);
      const login = await fetch(`${root}/api/auth/login`, { method: "POST", headers, body: JSON.stringify({ name: "admin", password: "test-password" }) });
      const cookie = login.headers.get("set-cookie")!.split(";")[0];
      const books: any = await (await fetch(`${root}/api/books`, { headers: { cookie } })).json();
      expect(books.configured).toBe(true);
      expect(books.books).toHaveLength(1);
      const newBook: any = await (await fetch(`${root}/api/books`, { method: "POST", headers: { ...headers, cookie }, body: JSON.stringify({ title: "数据库之书" }) })).json();
      expect(newBook.created).toBe(true);
      const status = await fetch(`${root}/api/status`, { headers: { cookie } });
      expect(status.status).toBe(200);
      const db = await openDatabase(`sqlite:${join(dir, "test.db")}`);
      await ensureSchema(db);
      const dao = new UsersDao(db);
      expect(await dao.count()).toBe(1);
      await db.close();
    } finally { await handle.close(); await rm(dir, { recursive: true, force: true }); }
  });
});
