/**
 * SynChronicle Cloudflare Worker 入口（P11-C1 切片）。
 * 覆盖：health / shell / D1 schema 初始化 / 书城 shelf / 注册登录（商用邀请码 + 自用 setup）/
 * 渠道管理与授权 / 模型清单 / 额度与兑换 / 举报与处置 / D1 版发布（含商用安全闸）。
 * AI 生成运行时（Host/Agent）仍在 Node 主线；本切片提供门户与平台管理面。
 */

import { z } from "zod";
import { ensureSchema } from "../src/db/sql-core.js";
import type { SqlDatabase } from "../src/db/sql-core.js";
import { ChannelsDao, QuotaDao, AuditDao, ReportsDao, type ChannelRow } from "../src/platform/dao.js";
import { UsersDao } from "../src/db/users.js";
import { PublishedEntrySchema, titleHue } from "../src/domain/publish.js";
import { scanSafety } from "../src/diag/safety.js";
import { splitChapters } from "../src/runtime/imp/chapters.js";
import { buildUpstreamRequest, collectUpstream, settleCost, sseEvent, CHAT_SYSTEM_PROMPT, type ChatTurn } from "./chat.js";
import { D1KvStore, type Env } from "./types.js";
import { WorkerCrypto, issueToken, verifyToken, maskKey, toHex, pbkdf2Hex } from "./crypto.js";
import { RuntimeHub } from "./object.js";

export { D1KvStore } from "./types.js";
export { RuntimeHub };

interface Ctx {
  env: Env;
  kv: D1KvStore;
  db: SqlDb;
  mode: "selfhost" | "commercial";
  users: UsersDao;
  channels: ChannelsDao;
  quota: QuotaDao;
  audit: AuditDao;
  reports: ReportsDao;
  crypto: WorkerCrypto;
  authSecret: Promise<string>;
  user?: { id: string; name: string; role: "admin" | "writer" };
}

type SqlDb = SqlDatabase;

/** D1 适配 SqlDatabase 接口：占位符 ?n 语法、batch 关闭为空操作。 */
function d1Adapter(db: D1Database): SqlDb {
  return {
    dialect: "sqlite" as const,
    run: async (sql, params = []) => { await db.prepare(sql).bind(...params).run(); },
    get: async <T>(sql: string, params: unknown[] = []) => { const { results } = await db.prepare(sql).bind(...params).all<T>(); return results[0] ?? null; },
    all: async <T>(sql: string, params: unknown[] = []) => { const { results } = await db.prepare(sql).bind(...params).all<T>(); return results; },
    close: async () => {},
  };
}

let schemaReady: Promise<void> | null = null;
function ensureReady(db: D1Database): Promise<void> {
  schemaReady ??= ensureSchema(d1Adapter(db));
  return schemaReady;
}

/** 测试专用：重置模块级缓存（schema/会话密钥）。 */
export function resetWorkerCache(): void { schemaReady = null; cachedSecret = null; }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      await ensureReady(env.DB);
      const db = d1Adapter(env.DB);
      const mode = env.MODE === "commercial" ? "commercial" : "selfhost";
      let secretPromise: Promise<string> | null = null;
      const ctx: Ctx = {
        env, kv: new D1KvStore(env.DB), db, mode,
        users: new UsersDao(db),
        channels: new ChannelsDao(db),
        quota: new QuotaDao(db),
        audit: new AuditDao(db),
        reports: new ReportsDao(db),
        crypto: WorkerCrypto.fromHex(env.MASTER_KEY ?? ""),
        get authSecret() { return secretPromise ??= authSecret(env); },
      };
      return await route(request, ctx);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  },
};

let cachedSecret: string | null = null;
async function authSecret(env: Env): Promise<string> {
  if (cachedSecret) return cachedSecret;
  if (env.AUTH_SECRET) { cachedSecret = env.AUTH_SECRET; return cachedSecret; }
  const kv = new D1KvStore(env.DB);
  const existing = (await kv.get("platform/.auth_secret")) ?? "";
  if (existing) { cachedSecret = existing; return existing; }
  const generated = [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  await kv.set("platform/.auth_secret", generated);
  cachedSecret = generated;
  return generated;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}

function fail(message: string, status: number): Response { return json({ error: message }, status); }

/** 同步路径白名单：books/<book>/... 或平台级 platform/{bookshelf,published}.json。 */
function syncPathAllowed(path: string, book: string | undefined): boolean {
  if (path === "platform/bookshelf.json" || path === "platform/published.json") return true;
  if (!/^books\/[^/]+\/[\w./-]+$/.test(path)) return false;
  return book ? path.startsWith(`books/${book}/`) : true;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > 1_000_000) throw new Error("请求体过大");
  const parsed: unknown = JSON.parse(raw || "{}");
  return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
}

function text(value: unknown, name: string): string { const out = typeof value === "string" ? value.trim() : ""; if (!out) throw new Error(`${name} 不能为空`); return out; }
function optional(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }

function parseCookie(header: string | null): string | null {
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === "sc_token") return part.slice(separator + 1).trim();
  }
  return null;
}

async function authed(ctx: Ctx, request: Request): Promise<Response | null> {
  const token = parseCookie(request.headers.get("cookie"));
  if (!token) return fail("未登录", 401);
  const payload = await verifyToken(token, await ctx.authSecret);
  if (!payload) return fail("登录已过期", 401);
  const row = await ctx.users.byId(payload.uid);
  if (!row || row.status === "disabled") return fail("账号不可用", 401);
  ctx.user = { id: row.id, name: row.name, role: row.role === "admin" ? "admin" : "writer" };
  return null;
}

async function route(request: Request, ctx: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === "GET" && path === "/api/health") return json({ ok: true });
  if (method === "GET" && path === "/api/shell") return json({ mode: ctx.mode, runtime: "worker", storage: "d1", features: { register: ctx.mode === "commercial", billing: ctx.mode === "commercial" } });

  // 匿名书城
  if (method === "GET" && path === "/api/shelf") return shelfList(ctx);
  if (method === "GET" && /^\/api\/shelf\/[^/]+$/.test(path)) return shelfBook(ctx, decodeURIComponent(path.split("/")[3] ?? ""));
  if (method === "GET" && /^\/api\/shelf\/[^/]+\/chapters\/\d+$/.test(path)) return shelfChapter(ctx, decodeURIComponent(path.split("/")[3] ?? ""), Number(path.split("/")[5]));

  // 匿名举报
  if (method === "POST" && path === "/api/reports") {
    const body = await readBody(request);
    await ctx.reports.create(text(body.entryId, "entryId"), optional(body.note));
    return json({ reported: true }, 201);
  }

  // 内部事件摄入（Node 主线边缘中继）：令牌校验后转发到对应 DO
  if (method === "POST" && path === "/api/internal/events") {
    const token = request.headers.get("x-internal-token") ?? "";
    if (!ctx.env.INTERNAL_TOKEN || token !== ctx.env.INTERNAL_TOKEN) return fail("forbidden", 403);
    const body = await readBody(request);
    const user = optional(body.user) || "*";
    const book = optional(body.book) || "*";
    const forward = new Request("https://runtime/events", { method: "POST", headers: { "content-type": "application/json", "x-internal-token": token }, body: JSON.stringify({ event: body.event, data: body.data }) });
    const hub = ctx.env.RUNTIME.get(ctx.env.RUNTIME.idFromName(`${user}:${book}`));
    return hub.fetch(forward);
  }

  // 内部内容同步（Node 主线 → 边缘）：批量 upsert/delete 书稿 kv 键
  if (method === "POST" && path === "/api/internal/sync") {
    const token = request.headers.get("x-internal-token") ?? "";
    if (!ctx.env.INTERNAL_TOKEN || token !== ctx.env.INTERNAL_TOKEN) return fail("forbidden", 403);
    const body = await readBody(request);
    const book = optional(body.book);
    const writes = Array.isArray(body.writes) ? body.writes : [];
    const deletes = Array.isArray(body.deletes) ? body.deletes : [];
    if (writes.length + deletes.length > 100) return fail("单次同步超过 100 个文件", 400);
    for (const item of writes as Array<Record<string, unknown>>) {
      if (typeof item.path !== "string" || typeof item.content !== "string") return fail("writes 条目需要 path/content", 400);
      if (!syncPathAllowed(item.path, book)) return fail(`非法同步路径: ${item.path}`, 400);
      if (item.content.length > 900_000) return fail(`文件过大: ${item.path}`, 413);
    }
    for (const item of deletes as Array<unknown>) {
      if (typeof item !== "string" || !syncPathAllowed(item, book)) return fail(`非法同步路径: ${item}`, 400);
    }
    for (const item of writes as Array<{ path: string; content: string }>) await ctx.kv.set(item.path, item.content);
    for (const item of deletes as string[]) await ctx.kv.delete(item);
    if (book && typeof body.owner === "string") await ctx.kv.set(`books/${book}/meta/book.json`, JSON.stringify({ ownerId: body.owner, updatedAt: new Date().toISOString() }));
    return json({ applied: writes.length, deleted: deletes.length });
  }

  // 认证入口（setup/register/login 无需会话）
  if (method === "POST" && path === "/api/auth/setup") return authSetup(request, ctx);
  if (method === "POST" && path === "/api/auth/register") return authRegister(request, ctx);
  if (method === "POST" && path === "/api/auth/login") return authLogin(request, ctx);

  // 以下全部需要会话
  const guard = await authed(ctx, request);
  if (guard) return guard;
  if (method !== "GET" && request.headers.get("x-requested-with") !== "fetch") return fail("请求缺少安全标识", 403);

  if (method === "GET" && path === "/api/auth/me") return json({ user: ctx.user ?? null });
  if (method === "POST" && path === "/api/auth/logout") return json({ ok: true }, 200, { "set-cookie": "sc_token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0" });

  // SSE：转发到该用户书籍级 RuntimeHub DO（回放 + 实时）
  if (method === "GET" && path === "/api/stream") {
    const book = url.searchParams.get("book") || "*";
    return ctx.env.RUNTIME.get(ctx.env.RUNTIME.idFromName(`${ctx.user!.id}:${book}`)).fetch(new Request("https://runtime/stream"));
  }
  if (method === "GET" && path === "/api/status") {
    const book = url.searchParams.get("book") || "*";
    const source = await ctx.env.RUNTIME.get(ctx.env.RUNTIME.idFromName(`${ctx.user!.id}:${book}`)).fetch(new Request("https://runtime/snapshot"));
    const payload = (await source.json().catch(() => ({}))) as Record<string, unknown>;
    return json({ ...payload, user: ctx.user, book });
  }

  // 书籍列表：读取同步上来的书架（platform/bookshelf.json），按所有权过滤
  if (method === "GET" && path === "/api/books") {
    const raw = await ctx.kv.get("platform/bookshelf.json");
    if (!raw) return json({ books: [], activeId: null });
    try {
      const shelf = JSON.parse(raw) as { books?: Array<Record<string, unknown>>; activeId?: string | null };
      const books = (shelf.books ?? []).filter((item) => ctx.user?.role === "admin" || item.ownerId === ctx.user?.id);
      return json({ books, activeId: books.some((item) => item.id === shelf.activeId) ? shelf.activeId : books[0]?.id ?? null });
    } catch { return json({ books: [], activeId: null }); }
  }

  if (path === "/api/admin/invite-codes") {
    if (method === "GET") return inviteList(ctx);
    if (method === "POST") return inviteCreate(request, ctx);
  }
  if (path === "/api/admin/recharge-codes") {
    if (method === "GET") { if (ctx.user?.role !== "admin") return fail("需要管理员权限", 403); return json({ codes: await ctx.quota.listRechargeCodes() }); }
    if (method === "POST") return rechargeCreate(request, ctx);
  }
  if (method === "GET" && path === "/api/admin/reports") return reportList(ctx, url.searchParams.get("status") ?? undefined);
  if (method === "POST" && /^\/api\/admin\/reports\/\d+\/handle$/.test(path)) return reportHandle(request, ctx, Number(path.split("/")[4]));

  if (path === "/api/channels") {
    if (method === "GET") return channelsList(ctx);
    if (method === "POST") return channelCreate(request, ctx);
  }
  if (/^\/api\/channels\/[^/]+$/.test(path) && method === "DELETE") return channelDelete(ctx, decodeURIComponent(path.split("/")[3] ?? ""));
  if (/^\/api\/channels\/[^/]+\/(grant|revoke)$/.test(path) && method === "POST") return channelGrant(request, ctx, decodeURIComponent(path.split("/")[3] ?? ""), path.endsWith("/grant"));

  if (method === "GET" && path === "/api/models") return modelsList(ctx);
  if (method === "GET" && path === "/api/quota") return quotaGet(ctx);
  if (method === "POST" && path === "/api/quota/redeem") return quotaRedeem(request, ctx);

  if (method === "GET" && path === "/api/publish") return publishList(ctx);
  if (method === "POST" && path === "/api/publish") return publish(request, ctx);
  if (method === "POST" && path === "/api/unpublish") return unpublish(request, ctx);

  // 导入：纯文本切分入库（R4 拆书同款解析器）；导出：txt 组装，R2 可选存储
  if (method === "POST" && path === "/api/import") return importText(request, ctx);
  if (method === "POST" && path === "/api/export") return exportBook(request, ctx);
  if (method === "GET" && path.startsWith("/api/export/file/")) return exportFile(ctx, decodeURIComponent(path.slice("/api/export/file/".length)));

  // 对话式生成（P11-C5）与两段式流水线（P11-C6）
  if (method === "GET" && path === "/api/chat") return chatHistory(ctx, url.searchParams.get("book") || "");
  if (method === "POST" && path === "/api/chat") return chatTurn(request, ctx);
  if (method === "POST" && path === "/api/compose") return compose(request, ctx);

  return fail("接口不存在（自动驾驶/Steer 等完整引擎仍需 Node 主线）", 404);
}

/** ---------- 书城（published.json 存于 kv: platform/published.json） ---------- */

interface ShelfFile { entries: unknown[]; updatedAt: string }

async function loadShelf(ctx: Ctx): Promise<ShelfFile> {
  const raw = await ctx.kv.get("platform/published.json");
  if (!raw) return { entries: [], updatedAt: new Date().toISOString() };
  try { const parsed = JSON.parse(raw) as ShelfFile; return { entries: Array.isArray(parsed.entries) ? parsed.entries : [], updatedAt: parsed.updatedAt ?? new Date().toISOString() }; } catch { return { entries: [], updatedAt: new Date().toISOString() }; }
}

async function saveShelf(ctx: Ctx, file: ShelfFile): Promise<void> { await ctx.kv.set("platform/published.json", JSON.stringify(file, null, 2)); }

async function shelfList(ctx: Ctx): Promise<Response> {
  const file = await loadShelf(ctx);
  const entries = (file.entries as Array<Record<string, unknown>>).filter((item) => item.visibility === "public").sort((a, b) => String(b.publishedAt ?? "").localeCompare(String(a.publishedAt ?? "")));
  return json({ entries });
}

async function shelfBook(ctx: Ctx, id: string): Promise<Response> {
  const file = await loadShelf(ctx);
  const entry = (file.entries as Array<Record<string, unknown>>).find((item) => item.id === id && item.visibility !== "private");
  if (!entry) return fail("书籍不存在", 404);
  const chapters: Array<Record<string, unknown>> = [];
  const progressRaw = await ctx.kv.get(`books/${id}/meta/progress.json`);
  if (progressRaw) {
    try {
      const progress = JSON.parse(progressRaw) as { completed_chapters?: number[]; chapter_word_counts?: Record<string, number> };
      const completed = new Set(progress.completed_chapters ?? []);
      const outlineRaw = await ctx.kv.get(`books/${id}/meta/outline.json`);
      const outline = outlineRaw ? (JSON.parse(outlineRaw) as Array<{ chapter?: number; title?: string }>) : [];
      for (const item of outline) {
        if (typeof item.chapter === "number" && completed.has(item.chapter)) chapters.push({ chapter: item.chapter, title: item.title ?? `第 ${item.chapter} 章`, words: progress.chapter_word_counts?.[String(item.chapter)] ?? 0, status: "completed" });
      }
    } catch { /* 目录缺失时返回空 */ }
  }
  return json({ entry, chapters });
}

async function shelfChapter(ctx: Ctx, id: string, chapter: number): Promise<Response> {
  const file = await loadShelf(ctx);
  const entry = (file.entries as Array<Record<string, unknown>>).find((item) => item.id === id && item.visibility !== "private");
  if (!entry) return fail("章节不存在", 404);
  const text = await ctx.kv.get(`books/${id}/chapters/${String(chapter).padStart(2, "0")}.md`);
  if (text === null) return fail("章节不存在", 404);
  const progressRaw = await ctx.kv.get(`books/${id}/meta/progress.json`);
  const completed = progressRaw ? ((JSON.parse(progressRaw) as { completed_chapters?: number[] }).completed_chapters ?? []).slice().sort((a, b) => a - b) : [];
  const index = completed.indexOf(chapter);
  const outlineRaw = await ctx.kv.get(`books/${id}/meta/outline.json`);
  const outline = outlineRaw ? (JSON.parse(outlineRaw) as Array<{ chapter?: number; title?: string }>) : [];
  return json({ title: outline.find((item) => item.chapter === chapter)?.title ?? `第 ${chapter} 章`, text, words: [...text.replace(/\s/g, "")].length, prev: completed[index - 1] ?? null, next: completed[index + 1] ?? null });
}

/** ---------- 认证 ---------- */

async function authSetup(request: Request, ctx: Ctx): Promise<Response> {
  if (ctx.mode === "commercial") return fail("商用模式通过邀请码注册", 403);
  const body = await readBody(request);
  const name = text(body.name, "用户名");
  const password = text(body.password, "密码");
  if (password.length < 8) return fail("密码至少 8 位", 400);
  if (await ctx.users.count() > 0) return fail("管理员已初始化", 403);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await pbkdf2Hex(password, salt);
  await ctx.users.upsert({ id, name, password_salt: salt, password_hash: hash, role: "admin", status: "active", quota_usd_remaining: 0, quota_usd_used: 0, created_at: now, updated_at: now });
  await ctx.audit.log(id, "auth.setup", "user:system", { name });
  return session(ctx, id);
}

async function authRegister(request: Request, ctx: Ctx): Promise<Response> {
  if (ctx.mode !== "commercial") return fail("自用模式注册关闭", 403);
  const body = await readBody(request);
  const name = text(body.name, "用户名");
  const password = text(body.password, "密码");
  const invite = text(body.inviteCode, "邀请码");
  if (password.length < 8) return fail("密码至少 8 位", 400);
  if (await ctx.users.byName(name)) return fail("用户名已存在", 409);
  const claim = await ctx.users.claimInvite(invite, "pending", new Date().toISOString());
  if (!claim.ok) return fail(claim.expired ? "邀请码已过期" : "邀请码无效或已使用", 400);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await pbkdf2Hex(password, salt);
  await ctx.users.upsert({ id, name, password_salt: salt, password_hash: hash, role: "writer", status: "active", quota_usd_remaining: claim.grantedUsd, quota_usd_used: 0, created_at: now, updated_at: now });
  await ctx.users.claimInvite(invite, id, now);
  await ctx.audit.log(id, "auth.register", `user:${id}`, { invite });
  return session(ctx, id);
}

async function authLogin(request: Request, ctx: Ctx): Promise<Response> {
  const body = await readBody(request);
  const name = text(body.name, "用户名");
  const row = await ctx.users.byName(name);
  if (!row || row.status === "disabled") return fail("用户名或密码错误", 401);
  const candidate = await pbkdf2Hex(text(body.password, "密码"), row.password_salt);
  if (candidate !== row.password_hash) return fail("用户名或密码错误", 401);
  await ctx.audit.log(row.id, "auth.login", `user:${row.id}`);
  return session(ctx, row.id);
}

async function session(ctx: Ctx, uid: string): Promise<Response> {
  const token = await issueToken(uid, await ctx.authSecret);
   return json({ user: { id: uid } }, 200, { "set-cookie": `sc_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${7 * 24 * 3600}` });
}

/** ---------- 管理面 ---------- */

async function requireAdmin(ctx: Ctx): Promise<Response | null> {
  return ctx.user?.role === "admin" ? null : fail("需要管理员权限", 403);
}

async function inviteList(ctx: Ctx): Promise<Response> {
  const denied = await requireAdmin(ctx); if (denied) return denied;
  return json({ codes: await ctx.users.listInvites() });
}

async function inviteCreate(request: Request, ctx: Ctx): Promise<Response> {
  const denied = await requireAdmin(ctx); if (denied) return denied;
  const body = await readBody(request);
  const count = Math.min(Math.max(Number(body.count ?? 1), 1), 20);
  const grantedUsd = Math.max(Number(body.grantedUsd ?? 0), 0);
  const codes: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const code = `inv-${toHex(crypto.getRandomValues(new Uint8Array(8)))}`;
    await ctx.users.createInvite(code, grantedUsd, ctx.user!.id, null);
    codes.push(code);
  }
  await ctx.audit.log(ctx.user!.id, "invite.create", `count:${count}`, { grantedUsd });
  return json({ codes }, 201);
}

async function rechargeCreate(request: Request, ctx: Ctx): Promise<Response> {
  const denied = await requireAdmin(ctx); if (denied) return denied;
  const body = await readBody(request);
  const count = Math.min(Math.max(Number(body.count ?? 1), 1), 20);
  const amountUsd = Math.max(Number(body.amountUsd ?? 0), 0);
  const codes: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const code = `rch-${toHex(crypto.getRandomValues(new Uint8Array(8)))}`;
    await ctx.quota.createRechargeCode(code, amountUsd, ctx.user!.id);
    codes.push(code);
  }
  await ctx.audit.log(ctx.user!.id, "recharge.create", `count:${count}`, { amountUsd });
  return json({ codes }, 201);
}

async function reportList(ctx: Ctx, status?: string): Promise<Response> {
  const denied = await requireAdmin(ctx); if (denied) return denied;
  return json({ reports: await ctx.reports.list(status) });
}

async function reportHandle(request: Request, ctx: Ctx, id: number): Promise<Response> {
  const denied = await requireAdmin(ctx); if (denied) return denied;
  const body = await readBody(request);
  const action = text(body.action, "action");
  if (action === "dismissed") {
    if (!await ctx.reports.handle(id, ctx.user!.id, "dismissed")) return fail("举报不存在", 404);
    await ctx.audit.log(ctx.user!.id, "report.dismiss", `report:${id}`);
    return json({ handled: true, status: "dismissed" });
  }
  if (action === "takedown") {
    const rows = await ctx.reports.list(undefined);
    const report = rows.find((item) => item.id === id);
    if (!report) return fail("举报不存在", 404);
    const file = await loadShelf(ctx);
    const before = file.entries.length;
    file.entries = (file.entries as Array<Record<string, unknown>>).filter((item) => item.id !== report.entry_id);
    await saveShelf(ctx, file);
    await ctx.reports.handle(id, ctx.user!.id, "takedown");
    await ctx.audit.log(ctx.user!.id, "report.takedown", `report:${id}`, { entry: report.entry_id, removed: before !== file.entries.length });
    return json({ handled: true, status: "takedown" });
  }
  return fail(`未知 action: ${action}`, 400);
}

/** ---------- 渠道与额度 ---------- */

function channelView(row: ChannelRow, models: string[]): Record<string, unknown> {
  return { id: row.id, name: row.name, provider: row.provider, baseUrl: row.base_url, models, shared: row.owner_id === null, status: row.status, apiKeyMasked: maskKey(maskedSource(row)), createdAt: row.created_at };
}

function maskedSource(row: ChannelRow): string { return row.api_key_ct.slice(0, 12); }

async function channelsList(ctx: Ctx): Promise<Response> {
  const user = ctx.user!;
  const own = user.role === "admin" ? await ctx.channels.listAll() : await ctx.channels.listForOwner(user.id);
  const granted = new Set(await ctx.channels.listGrantedIds(user.id));
  const pool = (await ctx.channels.listAdminPool()).filter((row) => granted.has(row.id));
  const seen = new Set<string>();
  const rows = [...own, ...pool].filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)));
  return json({ channels: rows.map((row) => channelView(row, safeModels(row.models))) });
}

function safeModels(raw: string): string[] { try { const parsed: unknown = JSON.parse(raw); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; } catch { return []; } }

async function channelCreate(request: Request, ctx: Ctx): Promise<Response> {
  const body = await readBody(request);
  const name = text(body.name, "名称");
  const provider = text(body.provider, "provider");
  const apiKey = text(body.apiKey, "apiKey");
  const models = Array.isArray(body.models) ? body.models.filter((item): item is string => typeof item === "string") : [];
  const shared = body.shared === true;
  if (shared && ctx.user!.role !== "admin") return fail("仅管理员可创建共享渠道", 403);
  const secret = await ctx.crypto.encrypt(apiKey);
  const row: ChannelRow = {
    id: crypto.randomUUID(), owner_id: shared ? null : ctx.user!.id, name, provider,
    base_url: optional(body.baseUrl) || "https://api.openai.com/v1",
    api_key_ct: secret.ct, api_key_iv: secret.iv, api_key_tag: secret.tag,
    models: JSON.stringify(models), weight: 1, status: "active", created_at: new Date().toISOString(),
  };
  await ctx.channels.create(row);
  await ctx.audit.log(ctx.user!.id, "channel.create", `channel:${row.id}`, { provider, shared });
  return json({ channel: channelView(row, models) }, 201);
}

async function channelDelete(ctx: Ctx, id: string): Promise<Response> {
  const row = await ctx.channels.get(id);
  if (!row) return fail("渠道不存在", 404);
  if (ctx.user!.role !== "admin" && row.owner_id !== ctx.user!.id) return fail("无权删除该渠道", 403);
  await ctx.channels.remove(id);
  await ctx.audit.log(ctx.user!.id, "channel.delete", `channel:${id}`);
  return json({ removed: true });
}

async function channelGrant(request: Request, ctx: Ctx, id: string, grant: boolean): Promise<Response> {
  const denied = await requireAdmin(ctx); if (denied) return denied;
  const body = await readBody(request);
  const userId = text(body.userId, "userId");
  const row = await ctx.channels.get(id);
  if (!row) return fail("渠道不存在", 404);
  if (grant) { await ctx.channels.grant(id, userId, new Date().toISOString()); await ctx.audit.log(ctx.user!.id, "channel.grant", `channel:${id}`, { userId }); }
  else { await ctx.channels.revoke(id, userId); await ctx.audit.log(ctx.user!.id, "channel.revoke", `channel:${id}`, { userId }); }
  return json({ ok: true });
}

async function modelsList(ctx: Ctx): Promise<Response> {
  const rows = await ctx.channels.effective(ctx.user!.id);
  const models = new Map<string, string>();
  for (const row of rows) for (const model of safeModels(row.models)) if (!models.has(model)) models.set(model, row.id);
  return json({ models: [...models.entries()].map(([id, channelId]) => ({ id, channelId })) });
}

async function quotaGet(ctx: Ctx): Promise<Response> {
  return json({ ...(await ctx.quota.balance(ctx.user!.id)), ledger: await ctx.quota.ledger(ctx.user!.id, 20) });
}

async function quotaRedeem(request: Request, ctx: Ctx): Promise<Response> {
  const body = await readBody(request);
  const result = await ctx.quota.redeem(text(body.code, "兑换码"), ctx.user!.id, new Date().toISOString());
  if (!result.ok) return fail("兑换码无效或已使用", 400);
  await ctx.audit.log(ctx.user!.id, "quota.redeem", `user:${ctx.user!.id}`, { amountUsd: result.amountUsd });
  return json({ redeemed: true, amountUsd: result.amountUsd });
}

/** ---------- 发布（D1/KV 版） ---------- */

async function publishList(ctx: Ctx): Promise<Response> {
  const books = await visibleBookIds(ctx);
  const file = await loadShelf(ctx);
  return json({ entries: (file.entries as Array<Record<string, unknown>>).filter((entry) => books.has(String(entry.id))) });
}

async function visibleBookIds(ctx: Ctx): Promise<Set<string>> {
  const ids = new Set<string>();
  const prefix = "books/";
  for (const key of await ctx.kv.list(`${prefix}`)) {
    const match = key.match(/^books\/([^/]+)\/meta\/progress\.json$/);
    if (match) ids.add(match[1]!);
  }
  // 管理员可见全部；普通用户仅本人书籍（owner 记录在 kv books/<id>/meta/book.json）
  if (ctx.user?.role !== "admin") {
    const owned = new Set<string>();
    for (const id of ids) {
      const meta = await ctx.kv.get(`books/${id}/meta/book.json`);
      if (meta) { try { if ((JSON.parse(meta) as { ownerId?: string }).ownerId === ctx.user!.id) owned.add(id); } catch { /* 忽略 */ } }
    }
    return owned;
  }
  return ids;
}

const PublishBody = z.object({ bookId: z.string().min(1), title: z.string().trim().min(1).max(60).optional(), synopsis: z.string().trim().max(300).optional(), tags: z.array(z.string().trim().max(12)).max(6).optional(), visibility: z.enum(["public", "unlisted", "private"]).default("public") });

async function publish(request: Request, ctx: Ctx): Promise<Response> {
  try {
    const body = PublishBody.parse(await readBody(request));
    const id = body.bookId;
    if (ctx.user?.role !== "admin") {
      const meta = await ctx.kv.get(`books/${id}/meta/book.json`);
      const ownerId = meta ? (JSON.parse(meta) as { ownerId?: string }).ownerId : undefined;
      if (ownerId !== ctx.user!.id) return fail("无权发布该书", 403);
    }
    const progressRaw = await ctx.kv.get(`books/${id}/meta/progress.json`);
    const progress = progressRaw ? JSON.parse(progressRaw) as { completed_chapters?: number[]; total_word_count?: number; novel_name?: string } : null;
    // 商用安全闸：逐章扫描
    if (ctx.mode === "commercial") {
      const findings: string[] = [];
      for (const chapter of progress?.completed_chapters ?? []) {
        const chapterText = await ctx.kv.get(`books/${id}/chapters/${String(chapter).padStart(2, "0")}.md`);
        if (!chapterText) continue;
        for (const hit of scanSafety(chapterText).hits) findings.push(`第 ${chapter} 章 ${hit.category} x${hit.count}: ${hit.samples.join("、").slice(0, 60)}`);
      }
      if (findings.length) return json({ error: "安全扫描未通过，存在严重命中，禁止发布", findings }, 422);
    }
    const file = await loadShelf(ctx);
    const entries = file.entries as Array<Record<string, unknown>>;
    const existing = entries.find((item) => item.id === id) as { publishedAt?: string } | undefined;
    const now = new Date().toISOString();
    const entry = PublishedEntrySchema.parse({
      id, title: body.title || progress?.novel_name || id, authorName: ctx.user!.name,
      synopsis: body.synopsis ?? "", tags: body.tags ?? [], visibility: body.visibility,
      hue: titleHue(body.title || id), publishedAt: existing?.publishedAt ?? now, updatedAt: now, aigcLabel: true,
      stats: { chapters: progress?.completed_chapters?.length ?? 0, words: progress?.total_word_count ?? 0 },
    });
    await saveShelf(ctx, { entries: [...entries.filter((item) => item.id !== id), entry], updatedAt: now });
    await ctx.audit.log(ctx.user!.id, "publish", `book:${id}`, { visibility: body.visibility });
    return json({ published: true, entry });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 400);
  }
}

async function unpublish(request: Request, ctx: Ctx): Promise<Response> {
  const body = await readBody(request);
  const id = text(body.bookId, "bookId");
  if (ctx.user?.role !== "admin") {
    const meta = await ctx.kv.get(`books/${id}/meta/book.json`);
    const ownerId = meta ? (JSON.parse(meta) as { ownerId?: string }).ownerId : undefined;
    if (ownerId !== ctx.user!.id) return fail("无权下架该书", 403);
  }
  const file = await loadShelf(ctx);
  const entries = file.entries as Array<Record<string, unknown>>;
  const next = entries.filter((item) => item.id !== id);
  await saveShelf(ctx, { entries: next, updatedAt: new Date().toISOString() });
  return json({ unpublished: next.length !== entries.length });
}

/** ---------- 导入/导出（P11-C4） ---------- */

async function bookOwner(ctx: Ctx, id: string): Promise<string | undefined> {
  const meta = await ctx.kv.get(`books/${id}/meta/book.json`);
  if (meta) { try { return (JSON.parse(meta) as { ownerId?: string }).ownerId; } catch { /* 忽略 */ } }
  const shelfRaw = await ctx.kv.get("platform/bookshelf.json");
  if (!shelfRaw) return undefined;
  try { const shelf = JSON.parse(shelfRaw) as { books?: Array<{ id: string; ownerId: string }> }; return shelf.books?.find((book) => book.id === id)?.ownerId; } catch { return undefined; }
}

async function requireBookAccess(ctx: Ctx, id: string): Promise<Response | null> {
  if (ctx.user?.role === "admin") return null;
  const owner = await bookOwner(ctx, id);
  if (owner !== ctx.user!.id) return fail("无权访问该书", 403);
  return null;
}

const ImportBody = z.object({ bookId: z.string().trim().min(1).max(64).regex(/^[\w-]+$/).optional(), title: z.string().trim().min(1).max(60).optional(), text: z.string().min(1).max(4_000_000) });

async function importText(request: Request, ctx: Ctx): Promise<Response> {
  try {
    const body = ImportBody.parse(await readBody(request));
    const chapters = splitChapters(body.text);
    if (!chapters.length) return fail("文本中没有可导入的章节", 400);
    const numbers = chapters.map((chapter) => chapter.chapter);
    if (new Set(numbers).size !== numbers.length || numbers.some((chapter) => chapter <= 0)) return fail("导入章节编号必须是唯一的正整数", 400);
    let id = body.bookId;
    if (id) {
      const denied = await requireBookAccess(ctx, id);
      if (denied) return denied;
    } else {
      id = `${(body.title ?? "import").replace(/[^\w-]/g, "").slice(0, 24) || "import"}-${Date.now().toString(36)}`;
    }
    const title = body.title ?? id;
    const now = new Date().toISOString();
    for (const chapter of chapters) {
      await ctx.kv.set(`books/${id}/chapters/${String(chapter.chapter).padStart(2, "0")}.md`, `# ${chapter.title}\n\n${chapter.content}`);
      await ctx.kv.set(`books/${id}/summaries/${String(chapter.chapter).padStart(2, "0")}.json`, JSON.stringify({ chapter: chapter.chapter, summary: "导入章节", characters: [], key_events: [] }));
    }
    const outline = chapters.map((chapter) => ({ chapter: chapter.chapter, title: chapter.title, scenes: [], hook: "" }));
    await ctx.kv.set(`books/${id}/meta/outline.json`, JSON.stringify(outline));
    await ctx.kv.set(`books/${id}/meta/progress.json`, JSON.stringify({
      novel_name: title, phase: "writing", current_chapter: Math.max(...numbers) + 1, total_chapters: Math.max(...numbers),
      completed_chapters: numbers, total_word_count: chapters.reduce((sum, chapter) => sum + [...chapter.content.replace(/\s/g, "")].length, 0),
      chapter_word_counts: Object.fromEntries(chapters.map((chapter) => [String(chapter.chapter), [...chapter.content.replace(/\s/g, "")].length])),
      flow: "writing", in_progress_chapter: 0, pending_rewrites: [],
    }));
    await ctx.kv.set(`books/${id}/meta/book.json`, JSON.stringify({ ownerId: ctx.user!.id, title, updatedAt: now }));
    const shelfRaw = await ctx.kv.get("platform/bookshelf.json");
    const shelf = shelfRaw ? JSON.parse(shelfRaw) as { books?: Array<Record<string, unknown>>; activeId?: string | null } : { books: [], activeId: null };
    const books = (shelf.books ?? []).filter((book) => book.id !== id);
    books.push({ id, title, createdAt: now, updatedAt: now, ownerId: ctx.user!.id });
    await ctx.kv.set("platform/bookshelf.json", JSON.stringify({ books, activeId: id, updatedAt: now }));
    await ctx.audit.log(ctx.user!.id, "import", `book:${id}`, { chapters: chapters.length });
    return json({ imported: true, bookId: id, chapters: chapters.length }, 201);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 400);
  }
}

const ExportBody = z.object({ bookId: z.string().trim().min(1).max(64), format: z.enum(["txt"]).default("txt") });

async function exportBook(request: Request, ctx: Ctx): Promise<Response> {
  try {
    const body = ExportBody.parse(await readBody(request));
    const denied = await requireBookAccess(ctx, body.bookId);
    if (denied) return denied;
    const progressRaw = await ctx.kv.get(`books/${body.bookId}/meta/progress.json`);
    const progress = progressRaw ? JSON.parse(progressRaw) as { completed_chapters?: number[]; novel_name?: string } : null;
    const completed = (progress?.completed_chapters ?? []).slice().sort((a, b) => a - b);
    if (!completed.length) return fail("没有可导出的已完成章节", 400);
    const title = (progress?.novel_name ?? body.bookId).trim() || body.bookId;
    const parts: string[] = [title];
    for (const chapter of completed) {
      const chapterText = await ctx.kv.get(`books/${body.bookId}/chapters/${String(chapter).padStart(2, "0")}.md`);
      if (chapterText) parts.push(`第 ${chapter} 章\n\n${chapterText.replace(/^#\s*[^\n]*\n+/, "")}`);
    }
    const text = parts.join("\n\n");
    if (!ctx.env.EXPORTS) return json({ stored: false, format: "txt", chapters: completed.length, text });
    const key = `exports/${ctx.user!.id}/${body.bookId}-${Date.now().toString(36)}.txt`;
    await ctx.env.EXPORTS.put(key, text, { httpMetadata: { contentType: "text/plain; charset=utf-8" } });
    await ctx.audit.log(ctx.user!.id, "export", `book:${body.bookId}`, { key, chapters: completed.length });
    return json({ stored: true, format: "txt", chapters: completed.length, key, path: `/api/export/file/${key}` }, 201);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 400);
  }
}

async function exportFile(ctx: Ctx, key: string): Promise<Response> {
  if (!key.startsWith(`exports/${ctx.user!.id}/`)) return fail("无权下载该导出文件", 403);
  if (!ctx.env.EXPORTS) return fail("导出存储未配置", 501);
  const object = await ctx.env.EXPORTS.get(key);
  if (!object) return fail("导出文件不存在", 404);
  return new Response(object.body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "content-disposition": `attachment; filename="${key.split("/").pop()}"` } });
}

/** ---------- 对话式生成（P11-C5） ---------- */

const CHAT_HISTORY_LIMIT = 20;

interface ResolvedChannel { picked: ChannelRow; model: string; apiKey: string }
type ChannelResolution = ResolvedChannel | { error: Response };

/** 渠道解析：模型匹配 + provider 守护 + 信封解密（chat 与 compose 共用）。 */
async function resolveGenerationChannel(ctx: Ctx, model?: string): Promise<ChannelResolution> {
  const channels = await ctx.channels.effective(ctx.user!.id);
  if (!channels.length) return { error: fail("没有可用模型渠道，请先在系统中创建", 400) };
  const named = model ? channels.find((row) => safeModels(row.models).includes(model)) : undefined;
  const picked = named ?? channels[0]!;
  const models = safeModels(picked.models);
  const resolvedModel = model && models.includes(model) ? model : models[0];
  if (!resolvedModel) return { error: fail("渠道没有配置模型", 400) };
  if (picked.provider === "anthropic" || picked.provider === "google") return { error: fail("该渠道 provider 暂不支持边缘生成（仅 OpenAI 兼容接口）", 400) };
  const apiKey = await ctx.crypto.decrypt({ ct: picked.api_key_ct, iv: picked.api_key_iv, tag: picked.api_key_tag });
  return { picked, model: resolvedModel, apiKey };
}

/** 单次流式生成：返回全文/usage，可选增量 sink；上游失败返回 null。 */
async function generateOnce(resolved: ResolvedChannel, messages: Array<{ role: string; content: string }>, sink?: (delta: string) => Promise<void> | void): Promise<{ text: string; usage: { input: number; output: number } } | null> {
  const upstream = await fetch(buildUpstreamRequest(resolved.picked, resolved.apiKey, resolved.model, messages));
  if (!upstream.ok || !upstream.body) return null;
  const result = await collectUpstream(upstream.body, sink);
  return { text: result.text.trim(), usage: result.usage };
}

/** 结算并审计一次生成（chat 与 compose 共用）。 */
async function settleAndAudit(ctx: Ctx, bookId: string, agent: string, model: string, usage: { input: number; output: number }): Promise<number> {
  const costUsd = settleCost(model, usage.input, usage.output);
  if (ctx.mode === "commercial") {
    await ctx.quota.settle(ctx.user!.id, { user_id: ctx.user!.id, book_id: bookId, agent, tokens_in: usage.input, tokens_out: usage.output, cost_usd: costUsd, created_at: new Date().toISOString() });
  }
  await ctx.audit.log(ctx.user!.id, agent, `book:${bookId}`, { model, tokensIn: usage.input, tokensOut: usage.output, costUsd });
  return costUsd;
}

async function loadChatHistory(ctx: Ctx, bookId: string): Promise<ChatTurn[]> {
  const raw = await ctx.kv.get(`books/${bookId}/meta/chat.jsonl`);
  if (!raw) return [];
  const turns: ChatTurn[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as { role?: unknown; content?: unknown };
      if ((value.role === "user" || value.role === "assistant") && typeof value.content === "string") turns.push(value as ChatTurn);
    } catch { /* 跳过坏行 */ }
  }
  return turns.slice(-CHAT_HISTORY_LIMIT);
}

async function appendChatTurn(ctx: Ctx, bookId: string, turn: ChatTurn): Promise<void> {
  const key = `books/${bookId}/meta/chat.jsonl`;
  const current = (await ctx.kv.get(key)) ?? "";
  await ctx.kv.set(key, `${current}${current.endsWith("\n") || !current ? "" : "\n"}${JSON.stringify(turn)}\n`);
}

async function chatHistory(ctx: Ctx, bookId: string): Promise<Response> {
  if (!bookId) return json({ turns: [] });
  const denied = await requireBookAccess(ctx, bookId);
  if (denied) return denied;
  return json({ turns: await loadChatHistory(ctx, bookId) });
}

const ChatBody = z.object({ bookId: z.string().trim().min(1).max(64), message: z.string().trim().min(1).max(32_000), model: z.string().trim().min(1).max(120).optional() });

async function chatTurn(request: Request, ctx: Ctx): Promise<Response> {
  let bookId = "";
  try {
    const body = ChatBody.parse(await readBody(request));
    bookId = body.bookId;
    const denied = await requireBookAccess(ctx, bookId);
    if (denied) return denied;

    // 渠道选择与鉴权（与流水线共用）
    const resolved = await resolveGenerationChannel(ctx, body.model);
    if ("error" in resolved) return resolved.error;
    const { picked, model, apiKey } = resolved;

    if (ctx.mode === "commercial") {
      const balance = await ctx.quota.balance(ctx.user!.id);
      if (balance.remaining <= 0) return fail("额度已用尽，请兑换或联系管理员", 402);
    }

    const history = await loadChatHistory(ctx, bookId);
    const messages = [
      { role: "system", content: CHAT_SYSTEM_PROMPT },
      ...history.map((turn) => ({ role: turn.role, content: turn.content })),
      { role: "user", content: body.message },
    ];

    const hub = ctx.env.RUNTIME.get(ctx.env.RUNTIME.idFromName(`${ctx.user!.id}:${bookId}`));
    const publish = (event: string, data: unknown): Promise<void> => hub.fetch(new Request("https://runtime/events", {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-token": ctx.env.INTERNAL_TOKEN ?? "" },
      body: JSON.stringify({ event, data }),
    })).then(() => undefined, () => undefined);

    const upstream = await fetch(buildUpstreamRequest(picked, apiKey, model, messages));
    if (!upstream.ok || !upstream.body) {
      const detail = (await upstream.text().catch(() => "")).slice(0, 300);
      await publish("runtime", { type: "error", message: `上游模型调用失败: ${upstream.status}` });
      return fail(`上游模型调用失败: ${upstream.status} ${detail}`, 502);
    }

    const started = new Date().toISOString();
    await appendChatTurn(ctx, bookId, { role: "user", content: body.message, time: started });
    await publish("runtime", { type: "system", message: "边缘生成开始", model });

    let full = "";
    let usage = { input: 0, output: 0 };
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const collected = await collectUpstream(upstream.body!, async (delta) => {
            full += delta;
            controller.enqueue(sseEvent("delta", { value: delta }));
            await publish("delta", { value: delta });
          });
          usage = collected.usage;
          const costUsd = settleCost(model, usage.input, usage.output);
          if (ctx.mode === "commercial") {
            await ctx.quota.settle(ctx.user!.id, { user_id: ctx.user!.id, book_id: bookId, agent: "chat", tokens_in: usage.input, tokens_out: usage.output, cost_usd: costUsd, created_at: new Date().toISOString() });
          }
          await appendChatTurn(ctx, bookId, { role: "assistant", content: full, model, usage, time: new Date().toISOString() });
          await ctx.audit.log(ctx.user!.id, "chat", `book:${bookId}`, { model, tokensIn: usage.input, tokensOut: usage.output, costUsd });
          controller.enqueue(sseEvent("done", { model, usage, costUsd }));
          await publish("runtime", { type: "system", message: "边缘生成完成", model, usage, costUsd });
        } catch (error) {
          controller.enqueue(sseEvent("error", { message: error instanceof Error ? error.message : String(error) }));
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" } });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 400);
  }
}

/** ---------- 两段式创作流水线（P11-C6）：策划 → 逐章成文 ---------- */

const ComposeBody = z.object({ bookId: z.string().trim().min(1).max(64), premise: z.string().trim().min(1).max(4000), chapters: z.number().int().min(1).max(12).default(3), wordsPerChapter: z.number().int().min(200).max(8000).default(800), model: z.string().trim().min(1).max(120).optional() });

interface PipelineChapter { chapter: number; title: string; outline: string; text: string; usage: { input: number; output: number } }

/** 解析策划输出：`第 N 章｜标题` 行 + 段落大纲。 */
export function parsePlan(text: string, expected: number): Array<{ chapter: number; title: string; outline: string }> {
  const entries: Array<{ chapter: number; title: string; outline: string }> = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]!.match(/^\s*(?:#{1,3}\s*)?第\s*(\d+)\s*章\s*[｜:：\-—]\s*(.+?)\s*$/);
    if (!match) continue;
    const outlineLines: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (/^\s*(?:#{1,3}\s*)?第\s*\d+\s*章\s*[｜:：\-—]/.test(lines[cursor]!)) break;
      if (lines[cursor]!.trim()) outlineLines.push(lines[cursor]!.trim());
    }
    entries.push({ chapter: Number(match[1]), title: match[2]!, outline: outlineLines.join("\n") });
  }
  entries.sort((a, b) => a.chapter - b.chapter);
  return entries.slice(0, expected);
}

async function compose(request: Request, ctx: Ctx): Promise<Response> {
  try {
    const body = ComposeBody.parse(await readBody(request));
    const bookId = body.bookId;
    const denied = await requireBookAccess(ctx, bookId);
    if (denied) return denied;
    const resolved = await resolveGenerationChannel(ctx, body.model);
    if ("error" in resolved) return resolved.error;
    if (ctx.mode === "commercial") {
      const balance = await ctx.quota.balance(ctx.user!.id);
      if (balance.remaining <= 0) return fail("额度已用尽，请兑换或联系管理员", 402);
    }

    const hub = ctx.env.RUNTIME.get(ctx.env.RUNTIME.idFromName(`${ctx.user!.id}:${bookId}`));
    const publish = (event: string, data: unknown): Promise<void> => hub.fetch(new Request("https://runtime/events", {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-token": ctx.env.INTERNAL_TOKEN ?? "" },
      body: JSON.stringify({ event, data }),
    })).then(() => undefined, () => undefined);

    // 阶段一：策划（大纲 + 每章要点）
    await publish("runtime", { type: "system", message: "策划开始", model: resolved.model, chapters: body.chapters });
    const planMessages = [
      { role: "system", content: "你是长篇小说策划。只输出章节计划，每章一行标题行，格式严格为：第 N 章｜标题，随后缩进列出 2-3 条剧情要点。不输出其他内容。" },
      { role: "user", content: `创作需求：${body.premise}\n请规划 ${body.chapters} 章的章节计划。` },
    ];
    const plan = await generateOnce(resolved, planMessages);
    if (plan === null) { await publish("runtime", { type: "error", message: "上游模型调用失败" }); return fail("上游模型调用失败", 502); }
    const planned = parsePlan(plan.text, body.chapters);
    if (!planned.length) { await publish("runtime", { type: "error", message: "策划输出无法解析章节计划" }); return fail("策划输出无法解析章节计划", 502); }
    await publish("runtime", { type: "system", message: "策划完成", planned: planned.length, usage: plan.usage });

    // 阶段二：逐章成文（流式增量推送到 SSE 与枢纽）
    const completed: PipelineChapter[] = [];
    const totalUsage = { input: plan.usage.input, output: plan.usage.output };
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(sseEvent("plan", { chapters: planned.map((item) => ({ chapter: item.chapter, title: item.title })), usage: plan.usage }));
          for (const item of planned) {
            await publish("runtime", { type: "system", message: `第 ${item.chapter} 章开始`, title: item.title });
            const writeMessages = [
              { role: "system", content: `你是长篇小说写手。依据大纲撰写本章正文，约 ${body.wordsPerChapter} 字。直接输出正文，不写章节标题，不复述大纲。` },
              { role: "user", content: `作品前提：${body.premise}\n\n本章大纲（第 ${item.chapter} 章 ${item.title}）：\n${item.outline}` },
            ];
            const chapterText = await generateOnce(resolved, writeMessages, async (delta) => {
              controller.enqueue(sseEvent("delta", { chapter: item.chapter, value: delta }));
              await publish("delta", { chapter: item.chapter, value: delta });
            });
            if (chapterText === null) { controller.enqueue(sseEvent("error", { message: `第 ${item.chapter} 章生成失败` })); continue; }
            completed.push({ chapter: item.chapter, title: item.title, outline: item.outline, text: `# ${item.title}\n\n${chapterText.text}`, usage: chapterText.usage });
            totalUsage.input += chapterText.usage.input;
            totalUsage.output += chapterText.usage.output;
            const words = [...chapterText.text.replace(/\s/g, "")].length;
            await ctx.kv.set(`books/${bookId}/chapters/${String(item.chapter).padStart(2, "0")}.md`, `# ${item.title}\n\n${chapterText.text}`);
            await ctx.kv.set(`books/${bookId}/summaries/${String(item.chapter).padStart(2, "0")}.json`, JSON.stringify({ chapter: item.chapter, summary: item.outline.slice(0, 200), characters: [], key_events: [] }));
            await publish("runtime", { type: "system", message: `第 ${item.chapter} 章完成`, words });
          }
          // 进度/大纲/书架元数据落库
          const numbers = completed.map((item) => item.chapter);
          const wordCount = completed.reduce((sum, item) => sum + [...item.text.replace(/\s/g, "")].length, 0);
          const progressRaw = await ctx.kv.get(`books/${bookId}/meta/progress.json`);
          const previous = progressRaw ? JSON.parse(progressRaw) as { completed_chapters?: number[]; total_word_count?: number; novel_name?: string } : null;
          const mergedChapters = [...new Set([...(previous?.completed_chapters ?? []), ...numbers])].sort((a, b) => a - b);
          await ctx.kv.set(`books/${bookId}/meta/progress.json`, JSON.stringify({
            novel_name: previous?.novel_name ?? "", phase: "writing", current_chapter: Math.max(...mergedChapters, 0) + 1, total_chapters: Math.max(...mergedChapters, 0),
            completed_chapters: mergedChapters, total_word_count: (previous?.total_word_count ?? 0) + wordCount,
            chapter_word_counts: Object.fromEntries(completed.map((item) => [String(item.chapter), [...item.text.replace(/\s/g, "")].length])),
            flow: "writing", in_progress_chapter: 0, pending_rewrites: [],
          }));
          const outlineRaw = await ctx.kv.get(`books/${bookId}/meta/outline.json`);
          const outline = outlineRaw ? JSON.parse(outlineRaw) as Array<Record<string, unknown>> : [];
          for (const item of completed) {
            const existing = outline.findIndex((entry) => entry.chapter === item.chapter);
            const entry = { chapter: item.chapter, title: item.title, scenes: [], hook: item.outline.slice(0, 120) };
            if (existing >= 0) outline[existing] = entry; else outline.push(entry);
          }
          outline.sort((a, b) => Number(a.chapter) - Number(b.chapter));
          await ctx.kv.set(`books/${bookId}/meta/outline.json`, JSON.stringify(outline));

          const costUsd = await settleAndAudit(ctx, bookId, "compose", resolved.model, totalUsage);
          controller.enqueue(sseEvent("done", { chapters: completed.map((item) => item.chapter), usage: totalUsage, costUsd }));
          await publish("runtime", { type: "system", message: "流水线完成", chapters: numbers, usage: totalUsage, costUsd });
        } catch (error) {
          controller.enqueue(sseEvent("error", { message: error instanceof Error ? error.message : String(error) }));
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" } });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 400);
  }
}
