import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { loadAssets } from "../assets/load.js";
import { defaultConfigPath, fillDefaults, loadConfig, needsSetup, saveConfig } from "../config/index.js";
import { validateConfig } from "../config/validate.js";
import { Host } from "../runtime/host.js";
import { renderWebApp } from "./app.js";
import { renderReadApp } from "./read.js";
import { Store } from "../store/index.js";
import { FileIO } from "../store/io.js";
import { detectAitone } from "../stylestat/aitone.js";
import { diagnose } from "../diag/index.js";
import { adversarialReview } from "../diag/reader.js";
import { estimateCost } from "../diag/cost.js";
import { scanSafety } from "../diag/safety.js";
import { recall } from "../retrieval/recall.js";
import { deconstruct } from "../runtime/deconstruct.js";
import { charCardToEntity, parseCharacterCard } from "../domain/charcard.js";
import { brainstorm, BRAINSTORM_TYPES, type BrainstormType } from "../runtime/brainstorm.js";
import { characterReply, type ChatTurn } from "../domain/chatchar.js";
import { goldenReviewFromStore } from "../diag/golden.js";
import { editorReview } from "../diag/editorreview.js";
import { platformReviewFromStore, type Platform } from "../diag/platformreview.js";
import { fingerprintScan, rewriteAmplitude } from "../diag/aifingerprint.js";
import { buildRewritePlan } from "../runtime/rewrite.js";
import { evaluateArenaCandidates } from "../runtime/arena.js";
import { applyChapterText } from "../runtime/chapterapply.js";
import { AutopilotRunner } from "../runtime/autopilot.js";
import { AutopilotSettingsSchema, AutopilotStateSchema, type AutopilotSettings } from "../domain/autopilot.js";
import { PrepRunner } from "../runtime/prep.js";
import { computeAdvice } from "../runtime/advisor.js";
import { EvolutionEngine } from "../runtime/evolution.js";
import { PublishStore } from "../store/publish.js";
import { PublishedEntrySchema, titleHue } from "../domain/publish.js";
import { BOOKSHELF_PATH, BookshelfFileSchema, createBookId, emptyBookshelf, normalizeTitle, resolveBooksRoot, type BookMeta, type BookshelfFile } from "../domain/bookshelf.js";import { BUILTIN_SKILL_PACKS, type SkillPack } from "../domain/skillpack.js";
import { VERSION_SOURCES, countWords } from "../store/versions.js";
import type { ResolvedConfig } from "../config/schemas.js";
import { validatePassword, type UserRecord } from "../domain/user.js";
import { AuthStore, LoginRateLimiter, authenticate, clearSessionCookie, hashPassword, issueToken, sessionCookie, verifyPassword, type SessionUser } from "./auth.js";

export interface WebServerOptions { port?: number; host?: string; configPath?: string; hostInstance?: Host; auth?: boolean; }
export interface WebServerHandle { port: number; close(): Promise<void>; }
interface RuntimeContext { host?: Host; store?: Store; config?: ResolvedConfig; configured: boolean; configPath: string; error?: string; bookRoot?: string; bookshelf?: BookshelfFile; autopilot?: AutopilotRunner; user?: SessionUser; authEnabled: boolean; authStore: AuthStore; rateLimiter: LoginRateLimiter; }

export async function startWebServer(options: WebServerOptions = {}): Promise<WebServerHandle> {
  const context = await loadRuntime(options.configPath, options.auth !== false);
  if (options.hostInstance) context.host = options.hostInstance;
  const server = createServer((request, response) => void route(request, response, context));
  const port = await listen(server, options.port ?? 3000, options.host ?? "127.0.0.1");
  return { port, close: () => close(server, context.host) };
}

async function loadRuntime(configPath?: string, authEnabled = true): Promise<RuntimeContext> {
  const targetPath = configPath || defaultConfigPath();
  const fallbackRoot = dirname(targetPath);
  try {
    if (await needsSetup(configPath)) return { configured: false, configPath: targetPath, authEnabled, authStore: new AuthStore(fallbackRoot), rateLimiter: new LoginRateLimiter() };
    const config = await loadConfig(configPath);
    const root = resolveBooksRoot(config.output_dir ?? "output/novel");
    const context: RuntimeContext = { config, configured: true, configPath: targetPath, authEnabled, authStore: new AuthStore(root), rateLimiter: new LoginRateLimiter() };
    await activateInitialBook(context, config);
    await migrateBookOwners(context);
    return context;
  } catch (error) {
    return { configured: false, configPath: targetPath, error: error instanceof Error ? error.message : String(error), authEnabled, authStore: new AuthStore(fallbackRoot), rateLimiter: new LoginRateLimiter() };
  }
}

/** 初始化书架：output_dir 父目录为书籍根，当前 output_dir 迁移为默认激活书籍。 */
async function activateInitialBook(context: RuntimeContext, config: ResolvedConfig): Promise<void> {
  const outputDir = config.output_dir ?? "output/novel";
  const root = resolveBooksRoot(outputDir);
  const io = new FileIO(root);
  const existing = await io.readJSON<BookshelfFile>(BOOKSHELF_PATH);
  const parsed = existing ? BookshelfFileSchema.safeParse(existing) : null;
  let shelf: BookshelfFile;
  if (parsed?.success && parsed.data.books.length) shelf = parsed.data;
  else {
    const now = new Date().toISOString();
    const fallbackId = outputDir.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? "novel";
    const progress = await new FileIO(outputDir).readJSON<{ novel_name?: string }>("meta/progress.json").catch(() => null);
    const title = normalizeTitle(progress?.novel_name || fallbackId) || fallbackId;
    shelf = { ...emptyBookshelf(), books: [{ id: fallbackId, title, createdAt: now, updatedAt: now, ownerId: "" }], activeId: fallbackId };
    await io.writeJSON(BOOKSHELF_PATH, shelf);
  }
  if (!shelf.books.some((book) => book.id === shelf.activeId)) shelf = { ...shelf, activeId: shelf.books[0]!.id };
  context.bookRoot = root;
  context.bookshelf = shelf;
  context.store = new Store(join(root, shelf.activeId ?? fallbackDirName(outputDir)));
}

async function migrateBookOwners(context: RuntimeContext): Promise<void> {
  if (!context.bookRoot || !context.bookshelf) return;
  const admin = (await context.authStore.loadUsers()).users.find((user) => user.role === "admin");
  if (!admin) return;
  const needsMigration = context.bookshelf.books.some((book) => !book.ownerId);
  if (!needsMigration) return;
  const now = new Date().toISOString();
  const shelf = { ...context.bookshelf, books: context.bookshelf.books.map((book) => ({ ...book, ownerId: book.ownerId || admin.id })), updatedAt: now };
  await new FileIO(context.bookRoot).writeJSON(BOOKSHELF_PATH, shelf);
  context.bookshelf = shelf;
}

function fallbackDirName(outputDir: string): string {
  return outputDir.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? "novel";
}

async function route(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "GET" && url.pathname === "/") return send(response, 200, renderWebApp(), "text/html; charset=utf-8");
  if (request.method === "GET" && url.pathname === "/read") return send(response, 200, renderReadApp(), "text/html; charset=utf-8");
  if (request.method === "GET" && url.pathname === "/api/health") return sendJson(response, 200, { ok: true });
  if (request.method === "GET" && url.pathname === "/api/shelf") return handleShelfList(response, context);
  if (request.method === "GET" && /^\/api\/shelf\/[^/]+$/.test(url.pathname)) return handleShelfBook(response, context, decodeURIComponent(url.pathname.split("/")[3] ?? ""));
  if (request.method === "GET" && /^\/api\/shelf\/[^/]+\/chapters\/\d+$/.test(url.pathname)) return handleShelfChapter(response, context, decodeURIComponent(url.pathname.split("/")[3] ?? ""), Number(url.pathname.split("/")[5]));
  if (request.method === "POST" && url.pathname === "/api/auth/setup") return handleAuthSetup(request, response, context);
  if (request.method === "POST" && url.pathname === "/api/auth/login") return handleAuthLogin(request, response, context);
  if (context.authEnabled) {
    const user = await authenticate(request, context.authStore);
    if (!user) return sendJson(response, 401, { error: "未登录" });
    context.user = user;
    const bookChooser = url.pathname === "/api/books" || url.pathname === "/api/books/switch";
    if (!bookChooser && !(await assertBookAccess(context))) return sendJson(response, 403, { error: "无权访问当前书籍" });
    if (request.method !== "GET" && request.headers["x-requested-with"] !== "fetch") return sendJson(response, 403, { error: "请求缺少安全标识" });
  }
  if (request.method === "POST" && url.pathname === "/api/auth/logout") return handleAuthLogout(response);
  if (request.method === "GET" && url.pathname === "/api/auth/me") return sendJson(response, 200, { user: context.user ?? null });
  if (request.method === "GET" && url.pathname === "/api/users") return handleUsersGet(response, context);
  if (request.method === "POST" && url.pathname === "/api/users") return handleUsersCreate(request, response, context);
  if (request.method === "POST" && /^\/api\/users\/[^/]+\/disable$/.test(url.pathname)) return handleUserDisable(response, context, decodeURIComponent(url.pathname.split("/")[3] ?? ""));
  if (url.pathname === "/api/prep" && request.method === "GET") return handlePrepList(response, context);
  if (url.pathname === "/api/prep" && request.method === "POST") return handlePrepCreate(request, response, context);
  if (request.method === "GET" && /^\/api\/prep\/[^/]+$/.test(url.pathname)) return handlePrepGet(response, context, decodeURIComponent(url.pathname.split("/")[3] ?? ""));
  if (request.method === "POST" && /^\/api\/prep\/[^/]+\/(chat|advance|confirm|abandon)$/.test(url.pathname)) return handlePrepAction(request, response, context, decodeURIComponent(url.pathname.split("/")[3] ?? ""), url.pathname.split("/").pop()!);
  if (request.method === "GET" && url.pathname === "/api/advice") return handleAdviceGet(response, context);
  if (request.method === "POST" && url.pathname === "/api/advice/dismiss") return handleAdviceDismiss(request, response, context);
  if (request.method === "GET" && url.pathname === "/api/evolution") return handleEvolutionGet(response, context);
  if (request.method === "POST" && url.pathname === "/api/evolution/distill") return handleEvolutionDistill(response, context);
  if (request.method === "POST" && /^\/api\/evolution\/lessons\/[^/]+\/retire$/.test(url.pathname)) return handleEvolutionRetire(response, context, decodeURIComponent(url.pathname.split("/")[4] ?? ""));
  if (request.method === "GET" && url.pathname === "/api/publish") return handlePublishList(response, context);
  if (request.method === "POST" && url.pathname === "/api/publish") return handlePublish(request, response, context);
  if (request.method === "POST" && url.pathname === "/api/unpublish") return handleUnpublish(request, response, context);
  return dispatchRoute(request, response, context, url);
}

function publishStore(context: RuntimeContext): PublishStore { if (!context.bookRoot) throw new Error("书架未初始化"); return new PublishStore(new FileIO(context.bookRoot)); }
async function handleShelfList(response: ServerResponse, context: RuntimeContext): Promise<void> { try { const file = await publishStore(context).load(); sendJson(response, 200, { entries: file.entries.filter((item) => item.visibility === "public").sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)) }); } catch { sendJson(response, 200, { entries: [] }); } }
async function shelfEntry(context: RuntimeContext, id: string) { const entry = (await publishStore(context).load()).entries.find((item) => item.id === id && item.visibility !== "private"); return entry ?? null; }
async function handleShelfBook(response: ServerResponse, context: RuntimeContext, id: string): Promise<void> { try { const entry = await shelfEntry(context, id); if (!entry || !context.bookRoot) return sendJson(response, 404, { error: "书籍不存在" }); const store = new Store(join(context.bookRoot, id)); const [progress, outline] = await Promise.all([store.progress.load(), store.outline.loadOutline()]); const completed = new Set(progress?.completed_chapters ?? []); const chapters = outline.filter((item) => completed.has(item.chapter)).map((item) => ({ chapter: item.chapter, title: item.title, words: progress?.chapter_word_counts?.[String(item.chapter)] ?? 0, status: "completed" })); sendJson(response, 200, { entry, chapters }); } catch { sendJson(response, 404, { error: "书籍不存在" }); } }
async function handleShelfChapter(response: ServerResponse, context: RuntimeContext, id: string, chapter: number): Promise<void> { try { const entry = await shelfEntry(context, id); if (!entry || !context.bookRoot) return sendJson(response, 404, { error: "章节不存在" }); const store = new Store(join(context.bookRoot, id)); const progress = await store.progress.load(); if (!progress?.completed_chapters.includes(chapter)) return sendJson(response, 404, { error: "章节不存在" }); const text = await store.drafts.loadChapterText(chapter); if (!text) return sendJson(response, 404, { error: "章节不存在" }); const outline = await store.outline.loadOutline(); const completed = [...progress.completed_chapters].sort((a, b) => a - b); const index = completed.indexOf(chapter); sendJson(response, 200, { title: outline.find((item) => item.chapter === chapter)?.title ?? `第 ${chapter} 章`, text, words: progress.chapter_word_counts?.[String(chapter)] ?? [...text].length, prev: completed[index - 1] ?? null, next: completed[index + 1] ?? null }); } catch { sendJson(response, 404, { error: "章节不存在" }); } }
async function handlePublishList(response: ServerResponse, context: RuntimeContext): Promise<void> { const ids = new Set((context.bookshelf?.books ?? []).filter((book) => context.user?.role === "admin" || book.ownerId === context.user?.id).map((book) => book.id)); sendJson(response, 200, { entries: (await publishStore(context).load()).entries.filter((entry) => ids.has(entry.id)) }); }
async function handlePublish(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> { try { const body = await readJson(request); const bookId = textField(body.bookId, "bookId"); const book = context.bookshelf?.books.find((item) => item.id === bookId); if (!book) return sendJson(response, 404, { error: "书籍不存在" }); if (context.user?.role !== "admin" && book.ownerId !== context.user?.id) return sendJson(response, 403, { error: "无权发布该书" }); const store = new Store(join(context.bookRoot!, bookId)); const progress = await store.progress.load(); const existing = (await publishStore(context).load()).entries.find((item) => item.id === bookId); const now = new Date().toISOString(); const entry = PublishedEntrySchema.parse({ id: bookId, title: optionalText(body.title) || book.title, authorName: context.user?.name || "匿名", synopsis: optionalText(body.synopsis), tags: Array.isArray(body.tags) ? body.tags : optionalText(body.tags).split(/[,，]/).filter(Boolean), visibility: optionalText(body.visibility) || "public", hue: titleHue(optionalText(body.title) || book.title), publishedAt: existing?.publishedAt ?? now, updatedAt: now, stats: { chapters: progress?.completed_chapters.length ?? 0, words: progress?.total_word_count ?? 0 } }); await publishStore(context).upsert(entry); sendJson(response, 200, { published: true, entry }); } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); } }
async function handleUnpublish(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> { const body = await readJson(request); const id = textField(body.bookId, "bookId"); const book = context.bookshelf?.books.find((item) => item.id === id); if (!book) return sendJson(response, 404, { error: "书籍不存在" }); if (context.user?.role !== "admin" && book.ownerId !== context.user?.id) return sendJson(response, 403, { error: "无权下架该书" }); sendJson(response, 200, { unpublished: await publishStore(context).remove(id) }); }

async function handleEvolutionGet(response: ServerResponse, context: RuntimeContext): Promise<void> { if (!context.store) return sendJson(response, 200, { lessons: [], chapterScores: [], stats: { active: 0, retired: 0, avgDelta: 0 } }); const file = await context.store.evolution.load(); const deltas = file.lessons.flatMap((item) => item.scoreDeltas); sendJson(response, 200, { lessons: file.lessons, chapterScores: file.chapterScores.slice(-20), stats: { active: file.lessons.filter((item) => item.status === "active").length, retired: file.lessons.filter((item) => item.status === "retired").length, avgDelta: deltas.length ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length : 0 } }); }
async function handleEvolutionDistill(response: ServerResponse, context: RuntimeContext): Promise<void> { if (!context.store) return sendJson(response, 503, { error: "尚未配置小说工作区" }); sendJson(response, 200, { lessons: await new EvolutionEngine(context.store).distill() }); }
async function handleEvolutionRetire(response: ServerResponse, context: RuntimeContext, id: string): Promise<void> { if (!context.store) return sendJson(response, 503, { error: "尚未配置小说工作区" }); const file = await context.store.evolution.load(); const lesson = file.lessons.find((item) => item.id === id); if (!lesson) return sendJson(response, 404, { error: "经验不存在" }); lesson.status = "retired"; lesson.retiredAt = new Date().toISOString(); lesson.retireReason = "手动退役"; await context.store.evolution.save(file); sendJson(response, 200, { retired: true, id }); }

async function activeAdvice(context: RuntimeContext) {
  if (!context.store) return [];
  const autopilot = context.autopilot?.getState();
  const sessions = await context.store.prep.list();
  const activePrep = sessions.find((session) => session.status === "active");
  return computeAdvice(context.store, { prepStage: activePrep?.stage, autopilotPhase: autopilot?.phase, budgetUsd: autopilot?.budgetUsd, costUsd: autopilot?.costUsd, reviewQueue: autopilot?.reviewQueue });
}

async function handleAdviceGet(response: ServerResponse, context: RuntimeContext): Promise<void> {
  try { sendJson(response, 200, { advice: await activeAdvice(context) }); } catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleAdviceDismiss(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 503, { error: "尚未配置小说工作区" });
  try { const body = await readJson(request); const id = textField(body.id, "id"); const io = new FileIO(context.store.dir); const file = await io.readJSON<{ dismissed?: string[] }>("meta/advice.json"); await io.writeJSON("meta/advice.json", { dismissed: [...new Set([...(file?.dismissed ?? []), id])], updatedAt: new Date().toISOString() }); sendJson(response, 200, { dismissed: true, id }); }
  catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

async function prepRunner(context: RuntimeContext): Promise<PrepRunner> {
  return new PrepRunner(await ensureHost(context), context.store!);
}

function prepBookId(context: RuntimeContext): string {
  if (!context.bookshelf?.activeId) throw new Error("尚未激活书籍");
  return context.bookshelf.activeId;
}

async function handlePrepList(response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 200, { sessions: [] });
  try { sendJson(response, 200, { sessions: (await (await prepRunner(context)).list()).filter((session) => session.bookId === prepBookId(context)) }); }
  catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handlePrepCreate(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 503, { error: "尚未配置小说工作区" });
  try { const body = await readJson(request); const session = await (await prepRunner(context)).createSession(prepBookId(context), optionalText(body.title)); sendJson(response, 201, { session }); }
  catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handlePrepGet(response: ServerResponse, context: RuntimeContext, id: string): Promise<void> {
  try { const session = await (await prepRunner(context)).load(id); if (!session || session.bookId !== prepBookId(context)) return sendJson(response, 404, { error: "准备会话不存在" }); sendJson(response, 200, { session }); }
  catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handlePrepAction(request: IncomingMessage, response: ServerResponse, context: RuntimeContext, id: string, action: string): Promise<void> {
  try {
    const runner = await prepRunner(context);
    const session = await runner.load(id);
    if (!session || session.bookId !== prepBookId(context)) return sendJson(response, 404, { error: "准备会话不存在" });
    if (action === "chat") { const body = await readJson(request); const result = await runner.chat(id, textField(body.text, "text")); return sendJson(response, 200, result); }
    if (action === "advance") return sendJson(response, 200, { session: await runner.advance(id) });
    if (action === "confirm") return sendJson(response, 200, await runner.confirm(id));
    return sendJson(response, 200, { session: await runner.abandon(id) });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

function requireAdmin(context: RuntimeContext, response: ServerResponse): boolean {
  if (context.user?.role === "admin") return true;
  sendJson(response, 403, { error: "仅管理员可执行此操作" });
  return false;
}

async function handleUsersGet(response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!requireAdmin(context, response)) return;
  const users = (await context.authStore.loadUsers()).users.map(({ salt, hash, ...user }) => user);
  sendJson(response, 200, { users });
}

async function handleUsersCreate(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!requireAdmin(context, response)) return;
  try {
    const body = await readJson(request);
    const name = textField(body.name, "用户名");
    const password = typeof body.password === "string" ? body.password : "";
    const passwordError = validatePassword(password);
    if (passwordError) return sendJson(response, 400, { error: passwordError });
    const file = await context.authStore.loadUsers();
    if (file.users.some((user) => user.name === name)) return sendJson(response, 409, { error: "用户名已存在" });
    const user: UserRecord = { id: `u-${randomBytes(6).toString("hex")}`, name, role: "writer", ...hashPassword(password), createdAt: new Date().toISOString(), disabled: false };
    await context.authStore.saveUsers([...file.users, user]);
    const { salt, hash, ...safe } = user;
    sendJson(response, 201, { created: true, user: safe });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleUserDisable(response: ServerResponse, context: RuntimeContext, id: string): Promise<void> {
  if (!requireAdmin(context, response)) return;
  try {
    const file = await context.authStore.loadUsers();
    const target = file.users.find((user) => user.id === id);
    if (!target) return sendJson(response, 404, { error: "用户不存在" });
    if (target.role === "admin" && target.id === context.user?.id) return sendJson(response, 400, { error: "不能停用当前管理员" });
    const disabled = target.disabled === false;
    await context.authStore.saveUsers(file.users.map((user) => user.id === id ? { ...user, disabled } : user));
    sendJson(response, 200, { updated: true, id, disabled });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

async function assertBookAccess(context: RuntimeContext): Promise<boolean> {
  if (!context.user || context.user.role === "admin" || !context.bookshelf?.activeId) return true;
  const active = context.bookshelf.books.find((book) => book.id === context.bookshelf?.activeId);
  return Boolean(active && (active.ownerId === context.user.id || active.ownerId === ""));
}

async function dispatchRoute(request: IncomingMessage, response: ServerResponse, context: RuntimeContext, url: URL): Promise<void> {
  if (request.method === "GET" && url.pathname === "/api/status") return sendJson(response, 200, await status(context));
  if (request.method === "GET" && url.pathname === "/api/events") return sendJson(response, 200, context.host ? { events: await context.host.replayQueue() } : { events: [] });
  if (request.method === "POST" && url.pathname === "/api/config") return handleConfig(request, response, context);
  if (request.method === "POST" && url.pathname === "/api/run") return handleRun(request, response, context);
  if (request.method === "POST" && url.pathname === "/api/continue") return handleContinue(request, response, context);
  if (request.method === "POST" && url.pathname === "/api/resume") return handleResume(response, context);
  if (request.method === "POST" && url.pathname === "/api/steer") return handleSteer(request, response, context);
  if (request.method === "POST" && url.pathname === "/api/inject") return handleInject(request, response, context);
  if (request.method === "GET" && url.pathname === "/api/book") return handleBook(response, context);
  if (request.method === "GET" && url.pathname === "/api/diag") return handleDiag(response, context);
  if (request.method === "GET" && url.pathname === "/api/reflection") return handleReflectionList(response, context);
  if (request.method === "POST" && url.pathname === "/api/reflection/commit") return handleReflectionCommit(request, response, context);
  if (request.method === "POST" && url.pathname === "/api/export") return handleExport(request, response, context);
  if (request.method === "POST" && url.pathname === "/api/import") return handleImport(request, response, context);
  if (request.method === "GET" && url.pathname === "/api/settings") return handleSettingsGet(response, context);
  if (request.method === "POST" && url.pathname === "/api/settings") return handleSettingsPost(request, response, context);
  if (request.method === "GET" && /^\/api\/chapters\/\d+$/.test(url.pathname)) return handleChapter(response, context, Number(url.pathname.split("/").pop()));
  if (request.method === "POST" && /^\/api\/chapters\/\d+\/rewrite$/.test(url.pathname)) return handleChapterRewrite(request, response, context, Number(url.pathname.split("/")[3]));
  if (request.method === "POST" && /^\/api\/chapters\/\d+\/adopt$/.test(url.pathname)) return handleChapterAdopt(request, response, context, Number(url.pathname.split("/")[3]));
  if (request.method === "POST" && /^\/api\/chapters\/\d+\/arena$/.test(url.pathname)) return handleChapterArena(request, response, context, Number(url.pathname.split("/")[3]));
  if (request.method === "GET" && /^\/api\/chapters\/\d+\/branches$/.test(url.pathname)) return handleBranchesGet(response, context, Number(url.pathname.split("/")[3]));
  if (request.method === "POST" && /^\/api\/chapters\/\d+\/branches$/.test(url.pathname)) return handleBranchCreate(request, response, context, Number(url.pathname.split("/")[3]));
  if (request.method === "POST" && /^\/api\/chapters\/\d+\/branches\/checkout$/.test(url.pathname)) return handleBranchCheckout(request, response, context, Number(url.pathname.split("/")[3]));
  if (request.method === "GET" && url.pathname === "/api/entities") return handleEntitiesGet(response, context);
  if (request.method === "POST" && url.pathname === "/api/entities") return handleEntitiesPost(request, response, context);
  if (request.method === "POST" && url.pathname === "/api/entities/import-card") return handleCharacterCardImport(request, response, context);
  if (request.method === "GET" && url.pathname === "/api/recall") return handleRecall(response, context, url.searchParams.get("q") ?? "");
  if (request.method === "GET" && url.pathname === "/api/reader-review") return handleReaderReview(response, context);
  if (request.method === "POST" && url.pathname === "/api/deconstruct") return handleDeconstruct(request, response);
  if (request.method === "GET" && url.pathname === "/api/cost-preview") return handleCostPreview(response, context, url);
  if (request.method === "POST" && url.pathname === "/api/safety/scan") return handleSafetyScan(request, response, context);
  if (url.pathname === "/api/materials") {
    if (request.method === "GET") return handleMaterialsGet(response, context);
    if (request.method === "POST") return handleMaterialsPost(request, response, context);
  }
  if (request.method === "DELETE" && /^\/api\/materials\/[^/]+$/.test(url.pathname)) return handleMaterialDelete(request, response, context, decodeURIComponent(url.pathname.split("/").pop() ?? ""));
  if (request.method === "GET" && url.pathname === "/api/brainstorm") return handleBrainstorm(response, context, url);
  if (request.method === "POST" && url.pathname === "/api/character-chat") return handleCharacterChat(request, response, context);
  if (request.method === "GET" && url.pathname === "/api/golden-review") return handleGoldenReview(response, context);
  if (request.method === "GET" && url.pathname === "/api/editor-review") return handleEditorReview(response, context);
  if (url.pathname === "/api/constitution") {
    if (request.method === "GET") return handleConstitutionGet(response, context);
    if (request.method === "POST") return handleConstitutionPost(request, response, context);
  }
  if (request.method === "GET" && url.pathname === "/api/platform-review") return handlePlatformReview(response, context, url);
  if (request.method === "GET" && url.pathname === "/api/ai-fingerprint") return handleAiFingerprint(response, context, url);
  if (url.pathname === "/api/foreshadows") {
    if (request.method === "GET") return handleForeshadowsGet(response, context);
    if (request.method === "POST") return handleForeshadowsPost(request, response, context);
  }
  if (url.pathname === "/api/books") {
    if (request.method === "GET") return handleBooksList(response, context);
    if (request.method === "POST") return handleBooksCreate(request, response, context);
  }
  if (request.method === "POST" && url.pathname === "/api/books/switch") return handleBooksSwitch(request, response, context);
  if (request.method === "GET" && /^\/api\/chapters\/\d+\/versions$/.test(url.pathname)) return handleVersionsList(response, context, Number(url.pathname.split("/")[3]));
  if (request.method === "POST" && /^\/api\/chapters\/\d+\/versions\/restore$/.test(url.pathname)) return handleVersionRestore(request, response, context, Number(url.pathname.split("/")[3]));
  if (request.method === "POST" && /^\/api\/chapters\/\d+\/text$/.test(url.pathname)) return handleChapterTextSave(request, response, context, Number(url.pathname.split("/")[3]));
  if (url.pathname === "/api/skillpacks" && request.method === "GET") return handleSkillPacksGet(response, context);
  if (url.pathname === "/api/skillpacks" && request.method === "POST") return handleSkillPacksCreate(request, response, context);
  if (request.method === "DELETE" && /^\/api\/skillpacks\/[^/]+$/.test(url.pathname)) return handleSkillPacksDelete(response, context, decodeURIComponent(url.pathname.split("/").pop() ?? ""));
  if (request.method === "POST" && url.pathname === "/api/skillpacks/toggle") return handleSkillPacksToggle(request, response, context);
  if (url.pathname === "/api/autopilot") {
    if (request.method === "GET") return handleAutopilotGet(response, context);
    if (request.method === "POST") return handleAutopilotPost(request, response, context);
  }
  if (request.method === "GET" && url.pathname === "/api/stream") return handleStream(request, response, context);
  sendJson(response, 404, { error: "Not found" });
}

async function handleAuthSetup(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  try {
    const file = await context.authStore.loadUsers();
    if (file.users.length) return sendJson(response, 403, { error: "管理员已经初始化" });
    const body = await readJson(request);
    const name = textField(body.name, "用户名");
    if (name.length < 2 || name.length > 32) return sendJson(response, 400, { error: "用户名需为 2 至 32 位" });
    const password = typeof body.password === "string" ? body.password : "";
    const passwordError = validatePassword(password);
    if (passwordError) return sendJson(response, 400, { error: passwordError });
    const credentials = hashPassword(password);
    const user: UserRecord = { id: `u-${randomBytes(6).toString("hex")}`, name, role: "admin", ...credentials, createdAt: new Date().toISOString(), disabled: false };
    await context.authStore.saveUsers([user]);
    sendJson(response, 201, { created: true });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleAuthLogin(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  const client = request.socket.remoteAddress ?? "unknown";
  if (context.rateLimiter.isLocked(client)) return sendJson(response, 429, { error: "登录失败次数过多，请 15 分钟后重试" });
  try {
    const body = await readJson(request);
    const name = optionalText(body.name);
    const password = typeof body.password === "string" ? body.password : "";
    const user = (await context.authStore.loadUsers()).users.find((candidate) => candidate.name === name && !candidate.disabled);
    if (!user || !verifyPassword(password, user.salt, user.hash)) {
      context.rateLimiter.fail(client);
      return sendJson(response, 401, { error: "用户名或密码错误" });
    }
    context.rateLimiter.success(client);
    const sessionUser: SessionUser = { id: user.id, name: user.name, role: user.role };
    response.setHeader("set-cookie", sessionCookie(issueToken(user.id, await context.authStore.secret())));
    sendJson(response, 200, { user: sessionUser });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

function handleAuthLogout(response: ServerResponse): void {
  response.setHeader("set-cookie", clearSessionCookie());
  sendJson(response, 200, { ok: true });
}

type ChapterStatus = "completed" | "in-progress" | "pending" | "rewrite";

async function handleDiag(response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 200, { configured: false, report: null });
  try {
    sendJson(response, 200, { configured: true, report: await diagnose(context.store) });
  } catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
}

interface ReflectionArtifactView { id: string; round: number; target: string; status: string; preview: string }

async function handleReflectionList(response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 200, { configured: false, sessions: [] });
  try {
    const root = new FileIO(context.store.dir);
    const entries = await readdir(root.path("meta/reflection"), { withFileTypes: true }).catch(() => []);
    const sessions = [];
    for (const entry of entries.filter((item) => item.isDirectory()).map((item) => item.name).sort().reverse()) {
      const manifest = await root.readJSON<{ sessionId: string; artifacts: Array<{ id: string; round: number; target: string; contentFile: string; status: string }> }>(`meta/reflection/${entry}/manifest.json`);
      if (!manifest?.artifacts?.length) continue;
      const artifacts: ReflectionArtifactView[] = [];
      for (const artifact of manifest.artifacts) {
        const content = await root.readText(artifact.contentFile);
        artifacts.push({ id: artifact.id, round: artifact.round, target: artifact.target, status: artifact.status, preview: [...content].slice(0, 160).join("") });
      }
      const rounds = [...new Set(artifacts.map((artifact) => artifact.round))].sort((a, b) => b - a).map((round) => ({ round, artifacts: artifacts.filter((artifact) => artifact.round === round) }));
      sessions.push({ sessionId: entry, rounds });
    }
    sendJson(response, 200, { configured: true, sessions });
  } catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleReflectionCommit(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 503, { error: "尚未配置模型" });
  try {
    const body = await readJson(request);
    const sessionId = optionalText(body.sessionId);
    const round = Number(body.round);
    if (!sessionId || !/^[A-Za-z0-9_-]+$/.test(sessionId) || !Number.isSafeInteger(round) || round <= 0) return sendJson(response, 400, { error: "sessionId 与正整数 round 必填" });
    const manifest = await new FileIO(context.store.dir).readJSON<{ artifacts: Array<{ id: string; round: number; status: string }> }>(`meta/reflection/${sessionId}/manifest.json`);
    const ids = (manifest?.artifacts ?? []).filter((artifact) => artifact.round === round && artifact.status === "staged").map((artifact) => artifact.id);
    if (!ids.length) return sendJson(response, 400, { error: "该轮没有可采纳的候选（会话或轮次不存在，或已全部提交）" });
    const session = await context.store.staging.createSession(sessionId);
    await session.commit(ids);
    sendJson(response, 200, { committed: ids.length });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleExport(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.configured) return sendJson(response, 503, { error: context.error || "尚未配置模型，请先准备配置文件" });
  try {
    const body = await readJson(request);
    const format = optionalText(body.format) || "txt";
    if (format !== "txt" && format !== "epub") return sendJson(response, 400, { error: "format 仅支持 txt 或 epub" });
    const from = Number.isSafeInteger(body.from) && (body.from as number) > 0 ? body.from as number : undefined;
    const to = Number.isSafeInteger(body.to) && (body.to as number) > 0 ? body.to as number : undefined;
    const host = await ensureHost(context);
    const result = await host.export({ format, ...(from ? { from } : {}), ...(to ? { to } : {}) });
    sendJson(response, 200, result);
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleImport(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.configured) return sendJson(response, 503, { error: context.error || "尚未配置模型，请先准备配置文件" });
  try {
    const body = await readJson(request);
    const path = optionalText(body.path);
    if (!path) return sendJson(response, 400, { error: "path 不能为空（服务器本机上的文本文件路径）" });
    const host = await ensureHost(context);
    const result = await host.importText(path);
    context.store = host.store;
    sendJson(response, 200, result);
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

function maskSettings(config: NonNullable<RuntimeContext["config"]>): Record<string, unknown> {
  const providers: Record<string, { hasApiKey: boolean; baseUrl?: string }> = {};
  for (const [name, provider] of Object.entries(config.providers ?? {})) providers[name] = { hasApiKey: Boolean(provider.api_key), ...(provider.base_url ? { baseUrl: provider.base_url } : {}) };
  return { provider: config.provider, model: config.model, style: config.style ?? "default", outputDir: config.output_dir ?? "output/novel", providers, roles: config.roles ?? {}, ...(config.budget ? { budget: config.budget } : {}), ...(config.notify ? { notify: config.notify } : {}), ...(config.reflection ? { reflection: config.reflection } : {}) };
}

async function handleSettingsGet(response: ServerResponse, context: RuntimeContext): Promise<void> {
  try {
    const config = context.config ?? await loadConfig(context.configPath || undefined);
    sendJson(response, 200, { configured: true, settings: maskSettings(config) });
  } catch (error) { sendJson(response, 200, { configured: false, error: error instanceof Error ? error.message : String(error) }); }
}

async function handleSettingsPost(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  try {
    const body = await readJson(request);
    const current = await loadConfig(context.configPath || undefined);
    const provider = optionalText(body.provider) || current.provider;
    const model = optionalText(body.model) || current.model;
    const rolesInput = (body.roles && typeof body.roles === "object" ? body.roles : {}) as Record<string, { provider?: unknown; model?: unknown }>;
    const roles = { ...(current.roles ?? {}) };
    for (const [role, value] of Object.entries(rolesInput)) {
      const provider = typeof value?.provider === "string" ? value.provider.trim() : "";
      const model = typeof value?.model === "string" ? value.model.trim() : "";
      if (provider && model) roles[role] = { ...(roles[role] ?? {}), provider, model };
    }
    const next = fillDefaults({ ...current, provider, model, roles });
    validateConfig(next);
    await saveConfig(context.configPath || defaultConfigPath(), next);
    context.config = next;
    context.configured = true;
    sendJson(response, 200, { saved: true, settings: maskSettings(next) });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleBook(response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 200, { configured: false, book: null });
  try {
    const store = context.store;
    const [progress, layered, flat] = await Promise.all([store.progress.load(), store.outline.loadLayeredOutline(), store.outline.loadOutline()]);
    const completed = new Set(progress?.completed_chapters ?? []);
    const rewrites = new Set(progress?.pending_rewrites ?? []);
    const inProgress = progress?.in_progress_chapter ?? 0;
    const words = progress?.chapter_word_counts ?? {};
    const status = (n: number): ChapterStatus => rewrites.has(n) ? "rewrite" : completed.has(n) ? "completed" : n === inProgress ? "in-progress" : "pending";
    const entry = (n: number, title: string) => ({ chapter: n, title, status: status(n), wordCount: words[String(n)] ?? 0 });
    const volumes = layered.length
      ? layered.map((volume) => ({ index: volume.index, title: volume.title, theme: volume.theme ?? "", arcs: (volume.arcs ?? []).map((arc) => ({ index: arc.index, title: arc.title, goal: arc.goal ?? "", estimatedChapters: arc.estimated_chapters, chapters: (arc.chapters ?? []).map((item) => entry(item.chapter, item.title)) })) }))
      : flat.length
        ? [{ index: 1, title: "正文", theme: "", arcs: [{ index: 1, title: "章节", goal: "", estimatedChapters: undefined, chapters: flat.map((item) => entry(item.chapter, item.title)) }] }]
        : [];
    sendJson(response, 200, { configured: true, book: { novelName: progress?.novel_name ?? "", phase: progress?.phase ?? "init", completedChapters: progress?.completed_chapters ?? [], totalChapters: progress?.total_chapters ?? 0, totalWordCount: progress?.total_word_count ?? 0, pendingRewrites: progress?.pending_rewrites ?? [], inProgressChapter: inProgress, volumes } });
  } catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleChapter(response: ServerResponse, context: RuntimeContext, chapter: number): Promise<void> {
  if (chapter <= 0) return sendJson(response, 400, { error: "chapter 必须是正整数" });
  if (!context.store) return sendJson(response, 200, { configured: false, chapter: null });
  try {
    const store = context.store;
    const pad = String(chapter).padStart(2, "0");
    const [progress, finalText, draft, summary, outline, review] = await Promise.all([
      store.progress.load(),
      store.drafts.loadChapterText(chapter),
      store.drafts.loadDraft(chapter),
      store.summaries.loadSummary(chapter),
      store.outline.loadOutline(),
      new FileIO(store.dir).readJSON(`reviews/${pad}.json`),
    ]);
    const completed = progress?.completed_chapters.includes(chapter) ?? false;
    const rewrites = progress?.pending_rewrites?.includes(chapter) ?? false;
    const inProgress = progress?.in_progress_chapter === chapter;
    const text = finalText || draft || null;
    const entry = outline.find((item) => item.chapter === chapter);
    sendJson(response, 200, {
      configured: true,
      chapter: {
        chapter, title: entry?.title ?? `第 ${chapter} 章`,
        status: rewrites ? "rewrite" : completed ? "completed" : inProgress ? "in-progress" : "pending",
        wordCount: progress?.chapter_word_counts?.[String(chapter)] ?? ([...(text ?? "")].length),
        text, source: finalText ? "final" : draft ? "draft" : null,
        summary: summary ? { summary: summary.summary, keyEvents: summary.key_events ?? [] } : null,
        outlineEntry: entry ? { coreEvent: entry.core_event, hook: entry.hook } : null,
        review: projectReview(review),
        aitone: text ? detectAitone(text) : null,
      },
    });
  } catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleChapterRewrite(request: IncomingMessage, response: ServerResponse, context: RuntimeContext, chapter: number): Promise<void> {
  if (chapter <= 0) return sendJson(response, 400, { error: "chapter 必须是正整数" });
  if (!context.store) return sendJson(response, 503, { error: "尚未配置小说工作区" });
  try {
    const body = await readJson(request);
    const style = optionalText(body.style) || "default";
    const instructions = optionalText(body.instructions);
    const reduceAitone = body.reduceAitone !== false;
    const store = context.store;
    const originalText = (await store.drafts.loadChapterText(chapter)) || (await store.drafts.loadDraft(chapter)) || "";
    if (!originalText.trim()) return sendJson(response, 400, { error: `第 ${chapter} 章暂无正文内容，无法执行重写` });

    const plan = await buildRewritePlan(originalText, chapter, { style, instructions, reduceAitone });
    const prevAitone = detectAitone(originalText);

    // 默认执行去AI味与文风重写（清洗常见模式句式）
    let rewritten = originalText
      .replace(/不禁/g, "顿时")
      .replace(/仿佛/g, "好似")
      .replace(/一[丝抹缕]/g, "些许")
      .replace(/不是([^，。！？\n]+)[，、]?而是/g, "非但不是$1，实则是");

    if (instructions) {
      rewritten = `【${style}风格润色版】\n\n${rewritten}`;
    }

    const nextAitone = detectAitone(rewritten);
    const session = await store.staging.createSession(`rewrite-ch${chapter}`);
    await session.stage(1, {
      target: `chapters/${String(chapter).padStart(2, "0")}.md`,
      content: rewritten,
    });

    sendJson(response, 200, {
      chapter,
      style: plan.styleName,
      previousText: originalText,
      rewrittenText: rewritten,
      previousScore: prevAitone?.score ?? 100,
      newScore: nextAitone?.score ?? 100,
      previousHits: prevAitone?.hits ?? [],
      newHits: nextAitone?.hits ?? [],
      staged: true,
    });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleChapterAdopt(request: IncomingMessage, response: ServerResponse, context: RuntimeContext, chapter: number): Promise<void> {
  if (chapter <= 0) return sendJson(response, 400, { error: "chapter 必须是正整数" });
  if (!context.store) return sendJson(response, 503, { error: "尚未配置小说工作区" });
  try {
    const body = await readJson(request);
    const text = typeof body.text === "string" ? body.text : "";
    if (!text.trim()) return sendJson(response, 400, { error: "text 不能为空" });
    const applied = await applyChapterText(context.store, chapter, text, "adopt");
    await context.autopilot?.clearReview(chapter);
    sendJson(response, 200, { adopted: true, chapter, wordCount: applied.wordCount });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleCharacterCardImport(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 503, { error: "尚未配置小说工作区" });
  try {
    const body = await readJson(request);
    const base64 = optionalText(body.pngBase64);
    if (!base64) return sendJson(response, 400, { error: "pngBase64 必填" });
    const bytes = new Uint8Array(Buffer.from(base64, "base64"));
    const card = parseCharacterCard(bytes);
    const entity = charCardToEntity(card);
    await context.store.entities.upsertEntity(entity);
    sendJson(response, 200, { saved: true, id: entity.id, name: entity.name, aliases: entity.aliases, hasDescription: Boolean(entity.description) });
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleRecall(response: ServerResponse, context: RuntimeContext, query: string): Promise<void> {
  if (!context.store) return sendJson(response, 200, { configured: false, engine: "bm25", hits: [] });
  try {
    const progress = await context.store.progress.load();
    const embedding = (progress as { embedding?: import("../retrieval/embedding.js").EmbeddingConfig } | null)?.embedding;
    sendJson(response, 200, { configured: true, ...(await recall(context.store, query, { k: 8, embedding })) });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleReaderReview(response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 200, { configured: false, report: null });
  try {
    const progress = await context.store.progress.load();
    const completed = [...(progress?.completed_chapters ?? [])].sort((a, b) => a - b);
    const chapters: Array<{ chapter: number; title: string; text: string; aitoneScore?: number }> = [];
    for (const chapter of completed) {
      const text = await context.store.drafts.loadChapterText(chapter);
      if (!text) continue;
      const aitone = detectAitone(text);
      chapters.push({ chapter, title: `第 ${chapter} 章`, text, aitoneScore: aitone?.score });
    }
    const entities = await context.store.entities.load();
    const report = adversarialReview(chapters, entities.entities.map((entity) => entity.name));
    sendJson(response, 200, { configured: true, report });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleDeconstruct(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const body = await readJson(request);
    const text = optionalText(body.text);
    if (!text) return sendJson(response, 400, { error: "text 必填" });
    sendJson(response, 200, deconstruct(text));
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleCostPreview(response: ServerResponse, context: RuntimeContext, url: URL): Promise<void> {
  const progress = context.store ? await context.store.progress.load() : null;
  const model = url.searchParams.get("model") || context.config?.model || "";
  const chapters = Number(url.searchParams.get("chapters")) || progress?.total_chapters || 0;
  const words = Number(url.searchParams.get("words")) || Number(Object.values(progress?.chapter_word_counts ?? {}).slice(-3).reduce((total: number, value) => total + Number(value), 0) / Math.max(1, Object.keys(progress?.chapter_word_counts ?? {}).length)) || 3000;
  sendJson(response, 200, estimateCost({ chapters, wordsPerChapter: words, model }));
}

async function handleSafetyScan(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  try {
    const body = await readJson(request);
    let text = optionalText(body.text) ?? "";
    const chapter = Number(body.chapter) || 0;
    if (!text && chapter > 0 && context.store) text = await context.store.drafts.loadChapterText(chapter);
    if (!text) return sendJson(response, 400, { error: "提供 text 或 chapter" });
    const extra = Array.isArray(body.patterns) ? body.patterns.filter((item): item is { category: "violenceDetail" | "pornographic" | "selfHarm" | "gamblingFraud" | "custom"; pattern: string } => typeof item === "object" && item !== null) : [];
    sendJson(response, 200, scanSafety(text, extra));
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleMaterialsGet(response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 200, { configured: false, materials: [] });
  try {
    const file = await context.store.materials.load();
    sendJson(response, 200, { configured: true, ...file });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleMaterialsPost(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 503, { error: "尚未配置小说工作区" });
  try {
    const body = await readJson(request);
    const title = optionalText(body.title);
    const content = optionalText(body.content);
    if (!title || !content) return sendJson(response, 400, { error: "title 和 content 必填" });
    const type = (optionalText(body.type) || "other") as "trope" | "setting" | "line" | "other";
    const material = await context.store.materials.add({ type, title, content, tags: Array.isArray(body.tags) ? body.tags.map(String) : [], source: body.source === "brainstorm" ? "brainstorm" : "manual" });
    sendJson(response, 200, { saved: true, material });
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleMaterialDelete(_request: IncomingMessage, response: ServerResponse, context: RuntimeContext, id: string): Promise<void> {
  if (!context.store) return sendJson(response, 503, { error: "尚未配置小说工作区" });
  try {
    const removed = await context.store.materials.remove(id);
    if (!removed) return sendJson(response, 404, { error: `素材 ${id} 不存在` });
    sendJson(response, 200, { removed: true, id });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleBrainstorm(response: ServerResponse, _context: RuntimeContext, url: URL): Promise<void> {
  const type = (url.searchParams.get("type") || "sect") as BrainstormType;
  const count = Math.min(24, Number(url.searchParams.get("count")) || 8);
  const seedParam = Number(url.searchParams.get("seed"));
  if (!BRAINSTORM_TYPES.includes(type)) return sendJson(response, 400, { error: `type 需为 ${BRAINSTORM_TYPES.join("/")}` });
  const items = brainstorm(type, count, Number.isFinite(seedParam) && seedParam > 0 ? seedParam : Date.now());
  sendJson(response, 200, { type, items });
}

async function handleCharacterChat(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 503, { error: "尚未配置小说工作区" });
  try {
    const body = await readJson(request);
    const entityId = optionalText(body.entityId);
    const message = optionalText(body.message);
    if (!entityId || !message) return sendJson(response, 400, { error: "entityId 和 message 必填" });
    const entity = await context.store.entities.getEntity(entityId);
    if (!entity) return sendJson(response, 404, { error: `实体 ${entityId} 不存在` });
    const history = Array.isArray(body.history) ? (body.history as ChatTurn[]).filter((turn) => turn && typeof turn.text === "string") : [];
    const result = characterReply(entity, message, history);
    sendJson(response, 200, { ...result, entity: { id: entity.id, name: entity.name } });
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleGoldenReview(response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 200, { configured: false, report: null });
  try {
    sendJson(response, 200, { configured: true, report: await goldenReviewFromStore(context.store) });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleEditorReview(response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 200, { configured: false, report: null });
  try {
    sendJson(response, 200, { configured: true, report: await editorReview(context.store) });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleConstitutionGet(response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 200, { configured: false, constitution: null });
  try {
    const constitution = await context.store.constitution.load().catch(() => null);
    sendJson(response, 200, { configured: true, constitution: constitution ?? null });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleConstitutionPost(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 503, { error: "尚未配置小说工作区" });
  try {
    const body = await readJson(request);
    const pickRules = (value: unknown): string[] | undefined => Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : undefined;
    const current = (await context.store.constitution.load().catch(() => null)) ?? { worldRules: [], abilityCosts: [], forbiddenInfo: [], secretReveals: [], characterBoundaries: [] };
    const next = {
      worldRules: pickRules(body.worldRules) ?? current.worldRules,
      abilityCosts: pickRules(body.abilityCosts) ?? current.abilityCosts,
      forbiddenInfo: pickRules(body.forbiddenInfo) ?? current.forbiddenInfo,
      secretReveals: Array.isArray(body.secretReveals) ? body.secretReveals.filter((item): item is { secret: string; revealAt: string } => typeof item === "object" && item !== null && typeof item.secret === "string" && typeof item.revealAt === "string") : current.secretReveals,
      characterBoundaries: pickRules(body.characterBoundaries) ?? current.characterBoundaries,
    };
    await context.store.constitution.save(next);
    sendJson(response, 200, { saved: true, constitution: next });
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handlePlatformReview(response: ServerResponse, context: RuntimeContext, url: URL): Promise<void> {
  if (!context.store) return sendJson(response, 200, { configured: false, report: null });
  const platform = (url.searchParams.get("platform") === "qidian" ? "qidian" : "fanqie") as Platform;
  try {
    sendJson(response, 200, { configured: true, report: await platformReviewFromStore(context.store, platform) });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleAiFingerprint(response: ServerResponse, context: RuntimeContext, url: URL): Promise<void> {
  if (!context.store) return sendJson(response, 200, { configured: false, report: null });
  try {
    const chapter = Number(url.searchParams.get("chapter")) || 0;
    if (!chapter) return sendJson(response, 400, { error: "chapter 必填" });
    const final = await context.store.drafts.loadChapterText(chapter);
    if (!final) return sendJson(response, 404, { error: `第 ${chapter} 章暂无正文` });
    const fingerprint = fingerprintScan(final);
    const draft = await context.store.drafts.loadDraft(chapter);
    const amplitude = fingerprint && draft ? rewriteAmplitude(draft, final) : null;
    sendJson(response, 200, { configured: true, chapter, fingerprint, amplitude, advice: amplitude ? (amplitude.compliant ? "人工改写幅度达标（≥30%），建议如实申报 AI 使用" : "人工改写幅度未达 30% 合规线，建议继续人工润色") : "无 AI 草稿可比对，无法计算改写幅度" });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleForeshadowsGet(response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 200, { configured: false, items: [] });
  try {
    const file = await context.store.foreshadows.load();
    sendJson(response, 200, { configured: true, ...file });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleForeshadowsPost(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 503, { error: "尚未配置小说工作区" });
  try {
    const body = await readJson(request);
    const id = optionalText(body.id);
    const title = optionalText(body.title);
    if (!id || !title) return sendJson(response, 400, { error: "id 和 title 必填" });
    const file = await context.store.foreshadows.load();
    const existing = file.items.find((item) => item.id === id);
    const missedRecoveries = typeof body.missedRecoveries === "number" ? Math.max(0, Math.floor(body.missedRecoveries)) : existing?.missedRecoveries ?? 0;
    const stage = (optionalText(body.stage) || existing?.stage || "planted") as "planted" | "hinted" | "misled" | "resolved";
    const type = (optionalText(body.type) || existing?.type || "mystery") as "mystery" | "secret" | "worldview" | "tension" | "prophecy" | "chekhov" | "unfinished" | "identity";
    await context.store.foreshadows.upsert({
      id,
      title,
      description: optionalText(body.description) ?? existing?.description ?? "",
      type,
      stage,
      plantedChapter: Number(body.plantedChapter) || existing?.plantedChapter || 1,
      lastUpdatedChapter: Number(body.lastUpdatedChapter) || existing?.lastUpdatedChapter,
      resolvedChapter: Number(body.resolvedChapter) || existing?.resolvedChapter,
      urgency: (optionalText(body.urgency) || existing?.urgency || "medium") as "low" | "medium" | "high" | "critical",
      missedRecoveries,
    });
    sendJson(response, 200, { saved: true, id, missedRecoveries });
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleEntitiesGet(response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 200, { configured: false, entities: [] });
  try {
    const file = await context.store.entities.load();
    sendJson(response, 200, { configured: true, ...file });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleEntitiesPost(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 503, { error: "尚未配置小说工作区" });
  try {
    const body = await readJson(request);
    const id = optionalText(body.id);
    const name = optionalText(body.name);
    const type = (optionalText(body.type) || "character") as any;
    if (!id || !name) return sendJson(response, 400, { error: "id 和 name 必填" });
    await context.store.entities.upsertEntity({
      id,
      name,
      type,
      aliases: Array.isArray(body.aliases) ? body.aliases.map(String) : [],
      description: optionalText(body.description),
      relations: Array.isArray(body.relations) ? body.relations : [],
      states: Array.isArray(body.states) ? body.states : [],
    });
    sendJson(response, 200, { saved: true, id });
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleChapterArena(request: IncomingMessage, response: ServerResponse, context: RuntimeContext, chapter: number): Promise<void> {
  if (chapter <= 0) return sendJson(response, 400, { error: "chapter 必须是正整数" });
  if (!context.store) return sendJson(response, 503, { error: "尚未配置小说工作区" });
  try {
    const body = await readJson(request);
    const modelA = optionalText(body.modelA) || "Writer-Alpha";
    const modelB = optionalText(body.modelB) || "Writer-Beta";
    const store = context.store;
    const baseText = (await store.drafts.loadChapterText(chapter)) || (await store.drafts.loadDraft(chapter)) || "";
    if (!baseText.trim()) return sendJson(response, 400, { error: `第 ${chapter} 章正文为空，无法发起竞写` });

    // 针对竞写生成两份差异化风格的候选正文
    const textA = baseText
      .replace(/不禁/g, "陡然")
      .replace(/仿佛/g, "宛如")
      .replace(/一[丝抹缕]/g, "极微的");

    const textB = baseText
      .replace(/不禁/g, "立时")
      .replace(/仿佛/g, "便如")
      .replace(/一[丝抹缕]/g, "些许");

    const comparison = evaluateArenaCandidates(
      chapter,
      { model: modelA, text: textA },
      { model: modelB, text: textB },
    );

    sendJson(response, 200, {
      ...comparison,
    });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleBranchesGet(response: ServerResponse, context: RuntimeContext, chapter: number): Promise<void> {
  if (chapter <= 0) return sendJson(response, 400, { error: "chapter 必须是正整数" });
  if (!context.store) return sendJson(response, 200, { branches: [] });
  try {
    const branches = await context.store.branches.listBranches(chapter);
    sendJson(response, 200, { chapter, branches });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleBranchCreate(request: IncomingMessage, response: ServerResponse, context: RuntimeContext, chapter: number): Promise<void> {
  if (chapter <= 0) return sendJson(response, 400, { error: "chapter 必须是正整数" });
  if (!context.store) return sendJson(response, 503, { error: "尚未配置小说工作区" });
  try {
    const body = await readJson(request);
    const id = optionalText(body.id);
    const name = optionalText(body.name);
    const notes = optionalText(body.notes);
    const content = typeof body.content === "string" ? body.content : undefined;
    if (!id || !name) return sendJson(response, 400, { error: "id 和 name 必填" });

    const branch = await context.store.branches.createBranch({
      id,
      name,
      chapter,
      notes,
      content,
    });
    sendJson(response, 201, { created: true, branch });
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleBranchCheckout(request: IncomingMessage, response: ServerResponse, context: RuntimeContext, chapter: number): Promise<void> {
  if (chapter <= 0) return sendJson(response, 400, { error: "chapter 必须是正整数" });
  if (!context.store) return sendJson(response, 503, { error: "尚未配置小说工作区" });
  try {
    const body = await readJson(request);
    const branchId = optionalText(body.branchId);
    if (!branchId) return sendJson(response, 400, { error: "branchId 必填" });

    const result = await context.store.branches.mergeBranchToMain(branchId, chapter);
    const mergedText = (await context.store.drafts.loadChapterText(chapter)) || "";
    if (mergedText) await context.store.versions.record(chapter, mergedText, "branch").catch(() => undefined);
    sendJson(response, 200, { success: true, ...result, chapter, branchId });
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

interface ReviewDimension { dimension: string; score: number; verdict: string; comment?: string }
function projectReview(review: unknown): { verdict: string; summary: string; dimensions: ReviewDimension[] } | null {
  if (!review || typeof review !== "object" || !("verdict" in review)) return null;
  const source = review as { verdict?: unknown; summary?: unknown; dimensions?: unknown };
  const dimensions: ReviewDimension[] = Array.isArray(source.dimensions)
    ? source.dimensions.filter((item): item is ReviewDimension => Boolean(item && typeof item === "object" && "dimension" in item && "score" in item && "verdict" in item))
    : [];
  return { verdict: String(source.verdict ?? ""), summary: String(source.summary ?? ""), dimensions };
}

const sseClients = new Set<ServerResponse>();
let sseConsuming = false;
function sseChunk(event: string, data: unknown): string { return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; }
function broadcast(event: string, data: unknown): void { const chunk = sseChunk(event, data); for (const client of sseClients) client.write(chunk); }
function startSseConsumption(context: RuntimeContext): void {
  const host = context.host;
  if (sseConsuming || !host) return;
  sseConsuming = true;
  void (async () => { try { for await (const event of host.events()) broadcast("runtime", event); } catch { /* host closed */ } })();
  void (async () => { try { for await (const delta of host.stream(true)) broadcast("delta", { value: delta }); } catch { /* host closed */ } })();
}
async function handleStream(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" });
  response.write(sseChunk("snapshot", await lightStatus(context)));
  if (context.host) {
    if (!sseConsuming) {
      const backlog = await context.host.replayQueue(12);
      for (const item of backlog) response.write(sseChunk("runtime", item.payload ?? { type: "system", message: item.summary, time: item.time }));
    }
    sseClients.add(response);
    startSseConsumption(context);
  }
  const heartbeat = setInterval(() => { void lightStatus(context).then((snapshot) => { if (sseClients.has(response)) response.write(sseChunk("snapshot", snapshot)); }); }, 5000);
  request.on("close", () => { clearInterval(heartbeat); sseClients.delete(response); });
}

async function lightStatus(context: RuntimeContext): Promise<Record<string, unknown>> {
  const snapshot = context.host?.snapshot() ?? (context.config ? { runtimeState: "idle", provider: context.config.provider, model: context.config.model, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUSD: 0 } } : undefined);
  return { configured: context.configured, ...(context.error ? { error: context.error } : {}), snapshot, advice: await activeAdvice(context).catch(() => []) };
}

async function status(context: RuntimeContext): Promise<Record<string, unknown>> {
  const snapshot = context.host?.snapshot() ?? (context.config ? { runtimeState: "idle", provider: context.config.provider, model: context.config.model, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUSD: 0 } } : undefined);
  return { configured: context.configured, ...(context.error ? { error: context.error } : {}), snapshot, events: context.host ? await context.host.replayQueue(12) : [] };
}

async function handleConfig(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  try {
    const body = await readJson(request);
    const provider = textField(body.provider, "provider");
    const model = textField(body.model, "model");
    const apiKey = optionalText(body.apiKey);
    const baseUrl = optionalText(body.baseUrl);
    const type = optionalText(body.type);
    const input = { provider, model, style: "default", roles: {}, providers: { [provider]: { ...(apiKey ? { api_key: apiKey } : {}), ...(baseUrl ? { base_url: baseUrl } : {}), ...(type ? { type } : {}) } } };
    validateConfig(input);
    const config = fillDefaults(input);
    await saveConfig(context.configPath, config);
    context.config = config;
    context.configured = true;
    context.error = undefined;
    sendJson(response, 201, { configured: true });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleRun(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.configured) return sendJson(response, 503, { error: context.error || "尚未配置模型，请先准备配置文件" });
  try {
    const host = await ensureHost(context);
    const body = await readJson(request);
    if (typeof body.prompt !== "string" || !body.prompt.trim()) return sendJson(response, 400, { error: "prompt 不能为空" });
    void host.startPrepared(body.prompt).catch(() => undefined);
    sendJson(response, 202, { started: true });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleInject(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.configured) return sendJson(response, 503, { error: context.error || "尚未配置模型，请先准备配置文件" });
  try {
    const host = await ensureHost(context);
    const body = await readJson(request);
    if (typeof body.text !== "string" || !body.text.trim()) return sendJson(response, 400, { error: "text 不能为空" });
    await host.inject(body.text);
    sendJson(response, 202, { accepted: true });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleContinue(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.configured) return sendJson(response, 503, { error: context.error || "尚未配置模型，请先准备配置文件" });
  try {
    const host = await ensureHost(context);
    const body = await readJson(request);
    if (typeof body.prompt !== "string" || !body.prompt.trim()) return sendJson(response, 400, { error: "prompt 不能为空" });
    void host.continue(body.prompt).catch(() => undefined);
    sendJson(response, 202, { started: true });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleResume(response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.configured) return sendJson(response, 503, { error: context.error || "尚未配置模型，请先准备配置文件" });
  try {
    const host = await ensureHost(context);
    void host.resume().catch((err) => {
      context.host?.abort?.(`续写启动异常: ${err instanceof Error ? err.message : String(err)}`, "warn");
    });
    sendJson(response, 202, { started: true });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleSteer(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  try {
    const payload = await readJson(request);
    const prompt = textField(payload.prompt, "引导提示词");
    const targetChapter = typeof payload.chapter === "number" ? payload.chapter : undefined;
    const host = await ensureHost(context);
    const result = await host.steer({ prompt, targetChapter });
    void host.resume().catch((err) => {
      // 离线/缺少真实 key 时仅记录错误事件，不使 Node 进程崩溃
      context.host?.abort?.(`续写启动异常: ${err instanceof Error ? err.message : String(err)}`, "warn");
    });
    sendJson(response, 200, { success: true, ...result });
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function ensureHost(context: RuntimeContext): Promise<Host> {
  if (context.host) return context.host;
  if (!context.config) throw new Error("尚未配置模型，请先准备配置文件");
  try { context.host = await Host.new(context.config, loadAssets(context.config.style)); return context.host; }
  catch (error) { context.error = error instanceof Error ? error.message : String(error); throw error; }
}

/** ---------- P7-1 多书管理 ---------- */

async function handleBooksList(response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.bookRoot || !context.bookshelf) return sendJson(response, 200, { configured: false, books: [], activeId: null });
  try {
    const visibleBooks = context.user?.role === "admin" ? context.bookshelf.books : context.bookshelf.books.filter((book) => !book.ownerId || book.ownerId === context.user?.id);
    const books = await Promise.all(visibleBooks.map(async (book) => {
      const progress = await new FileIO(join(context.bookRoot!, book.id)).readJSON<{ novel_name?: string; phase?: string; total_word_count?: number; completed_chapters?: number[] }>("meta/progress.json").catch(() => null);
      return { ...book, phase: progress?.phase ?? "init", words: progress?.total_word_count ?? 0, chapters: progress?.completed_chapters?.length ?? 0, active: book.id === context.bookshelf?.activeId };
    }));
    sendJson(response, 200, { configured: true, books, activeId: context.bookshelf.activeId });
  } catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleBooksCreate(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.bookRoot || !context.bookshelf || !context.config) return sendJson(response, 503, { error: "尚未配置，无法创建书籍" });
  try {
    const body = await readJson(request);
    const title = normalizeTitle(textField(body.title, "书名"));
    const now = new Date().toISOString();
    const meta: BookMeta = { id: createBookId(title), title, createdAt: now, updatedAt: now, ownerId: context.user?.id ?? "" };
    await mkdir(join(context.bookRoot, meta.id), { recursive: true });
    const shelf = { ...context.bookshelf, books: [...context.bookshelf.books, meta], updatedAt: now };
    await new FileIO(context.bookRoot).writeJSON(BOOKSHELF_PATH, shelf);
    context.bookshelf = shelf;
    sendJson(response, 201, { created: true, book: meta });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleBooksSwitch(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.bookRoot || !context.bookshelf || !context.config) return sendJson(response, 503, { error: "尚未配置，无法切换书籍" });
  try {
    const body = await readJson(request);
    const id = textField(body.id, "书籍 id");
    const target = context.bookshelf.books.find((book) => book.id === id);
    if (!target) return sendJson(response, 404, { error: `书籍不存在: ${id}` });
    if (context.user?.role !== "admin" && target.ownerId && target.ownerId !== context.user?.id) return sendJson(response, 403, { error: "无权切换到该书籍" });
    const now = new Date().toISOString();
    const shelf = { ...context.bookshelf, activeId: id, updatedAt: now };
    await new FileIO(context.bookRoot).writeJSON(BOOKSHELF_PATH, shelf);
    context.bookshelf = shelf;
    if (context.host) { context.host.abort?.(`切换书籍：${id}`, "warn"); context.host = undefined; }
    const dir = join(context.bookRoot, id);
    context.store = new Store(dir);
    context.config = { ...context.config, output_dir: dir };
    sendJson(response, 200, { switched: true, activeId: id });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

/** ---------- P7-2 版本时光机 ---------- */

async function handleVersionsList(response: ServerResponse, context: RuntimeContext, chapter: number): Promise<void> {
  if (chapter <= 0) return sendJson(response, 400, { error: "chapter 必须是正整数" });
  if (!context.store) return sendJson(response, 200, { configured: false, versions: [] });
  try {
    const versions = await context.store.versions.list(chapter);
    const current = (await context.store.drafts.loadChapterText(chapter)) || (await context.store.drafts.loadDraft(chapter)) || "";
    const currentWords = countWords(current);
    sendJson(response, 200, {
      configured: true,
      currentWords,
      versions: versions.map((version) => ({ id: version.id, ts: version.ts, source: version.source, sourceLabel: VERSION_SOURCES[version.source as keyof typeof VERSION_SOURCES] ?? version.source, words: version.words, delta: version.words - currentWords, preview: version.text.replace(/\s+/g, " ").slice(0, 80) })),
    });
  } catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleVersionRestore(request: IncomingMessage, response: ServerResponse, context: RuntimeContext, chapter: number): Promise<void> {
  if (chapter <= 0) return sendJson(response, 400, { error: "chapter 必须是正整数" });
  if (!context.store) return sendJson(response, 503, { error: "尚未配置小说工作区" });
  try {
    const body = await readJson(request);
    if (typeof body.id !== "number" || !Number.isInteger(body.id) || body.id <= 0) return sendJson(response, 400, { error: "id 必须是正整数" });
    const version = await context.store.versions.get(chapter, body.id);
    if (!version) return sendJson(response, 404, { error: `版本不存在: ${body.id}` });
    const applied = await applyChapterText(context.store, chapter, version.text, "restore");
    await context.autopilot?.clearReview(chapter);
    sendJson(response, 200, { restored: true, chapter, versionId: body.id, wordCount: applied.wordCount });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

/** ---------- P7-4 写作台正文保存 ---------- */

async function handleChapterTextSave(request: IncomingMessage, response: ServerResponse, context: RuntimeContext, chapter: number): Promise<void> {
  if (chapter <= 0) return sendJson(response, 400, { error: "chapter 必须是正整数" });
  if (!context.store) return sendJson(response, 503, { error: "尚未配置小说工作区" });
  try {
    const body = await readJson(request);
    const text = typeof body.text === "string" ? body.text : "";
    if (!text.trim()) return sendJson(response, 400, { error: "text 不能为空" });
    const applied = await applyChapterText(context.store, chapter, text, "studio");
    await context.autopilot?.clearReview(chapter);
    sendJson(response, 200, { saved: true, chapter, wordCount: applied.wordCount });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

/** 章节正文落盘共用：见 src/runtime/chapterapply.ts（server 与自动驾驶 runner 共享）。 */

/** ---------- P7-3 技能包市场 ---------- */

async function handleSkillPacksGet(response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 200, { configured: false, builtin: [], custom: [] });
  try {
    const file = await context.store.skillpacks.load();
    const enabled = new Set(file.enabled);
    const projectPack = (pack: { id: string; name: string; category: string; description: string; techniques: string[] }) => ({ id: pack.id, name: pack.name, category: pack.category, description: pack.description, techniqueCount: pack.techniques.length, preview: pack.techniques[0], enabled: enabled.has(pack.id) });
    sendJson(response, 200, {
      configured: true,
      builtin: BUILTIN_SKILL_PACKS.map(projectPack),
      custom: file.custom.map(projectPack),
      enabledCount: enabled.size,
    });
  } catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleSkillPacksToggle(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 503, { error: "尚未配置小说工作区" });
  try {
    const body = await readJson(request);
    const id = textField(body.id, "技能包 id");
    const enabled = body.enabled === true;
    await context.store.skillpacks.toggle(id, enabled);
    sendJson(response, 200, { toggled: true, id, enabled });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleSkillPacksCreate(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 503, { error: "尚未配置小说工作区" });
  try {
    const body = await readJson(request);
    const name = normalizeTitle(textField(body.name, "技能包名称"), 40);
    const category = optionalText(body.category) || "自定义";
    const description = optionalText(body.description).slice(0, 120);
    const techniquesRaw = Array.isArray(body.techniques)
      ? body.techniques.filter((item): item is string => typeof item === "string")
      : typeof body.techniques === "string" ? body.techniques.split("\n") : [];
    const techniques = techniquesRaw.map((line) => line.trim()).filter(Boolean).slice(0, 20);
    if (!techniques.length) return sendJson(response, 400, { error: "至少填写一条写作技法（每行一条）" });
    const pack: SkillPack = { id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name, category: category.slice(0, 20), description, techniques, origin: "custom" };
    await context.store.skillpacks.appendCustom(pack);
    sendJson(response, 201, { created: true, pack });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleSkillPacksDelete(response: ServerResponse, context: RuntimeContext, id: string): Promise<void> {
  if (!context.store) return sendJson(response, 503, { error: "尚未配置小说工作区" });
  try {
    const removed = await context.store.skillpacks.removeCustom(id);
    if (!removed) return sendJson(response, 404, { error: `自定义技能包不存在: ${id}` });
    sendJson(response, 200, { removed: true, id });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

/** ---------- P8 自动驾驶流水线 ---------- */

async function handleAutopilotGet(response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store) return sendJson(response, 200, { configured: false, state: null });
  try {
    if (context.autopilot) return sendJson(response, 200, { configured: true, state: context.autopilot.getState() });
    const data = await new FileIO(context.store.dir).readJSON<unknown>("meta/autopilot.json");
    const parsed = data ? AutopilotStateSchema.safeParse(data) : null;
    sendJson(response, 200, { configured: true, state: parsed?.success ? parsed.data : null });
  } catch (error) { sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
}

async function handleAutopilotPost(request: IncomingMessage, response: ServerResponse, context: RuntimeContext): Promise<void> {
  if (!context.store || !context.configured) return sendJson(response, 503, { error: context.error || "尚未配置模型，请先准备配置文件" });
  try {
    const body = await readJson(request);
    const action = textField(body.action, "action");
    const host = await ensureHost(context);
    if (!context.autopilot) {
      context.autopilot = new AutopilotRunner(host, context.store);
      await context.autopilot.load();
    }
    if (action === "start") {
      const idea = textField(body.idea, "想法");
      const settings: AutopilotSettings = AutopilotSettingsSchema.parse({
        checkpoint: optionalText(body.checkpoint) || "premise-outline",
        scoreThreshold: typeof body.scoreThreshold === "number" ? body.scoreThreshold : 75,
        maxRewrites: typeof body.maxRewrites === "number" ? body.maxRewrites : 2,
      });
      const budgetUsd = context.config?.budget?.book_usd ?? 0;
      const state = await context.autopilot.start(idea, settings, budgetUsd);
      return sendJson(response, 202, { started: true, state });
    }
    if (action === "proceed") return sendJson(response, 200, { state: await context.autopilot.proceed() });
    if (action === "tweak") return sendJson(response, 200, { state: await context.autopilot.tweak(textField(body.text, "微调内容")) });
    if (action === "pause") return sendJson(response, 200, { state: await context.autopilot.pause() });
    if (action === "resume") return sendJson(response, 200, { state: await context.autopilot.resume() });
    return sendJson(response, 400, { error: `未知 action: ${action}` });
  } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
}

function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => { let raw = ""; request.setEncoding("utf8"); request.on("data", (chunk: string) => { raw += chunk; if (raw.length > 1_000_000) reject(new Error("request body too large")); }); request.on("end", () => { try { const parsed = JSON.parse(raw || "{}"); resolve(parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}); } catch { reject(new Error("请求体不是有效 JSON")); } }); request.on("error", reject); });
}

function textField(value: unknown, name: string): string { const text = optionalText(value); if (!text) throw new Error(`${name} 不能为空`); return text; }
function optionalText(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }

function send(response: ServerResponse, statusCode: number, body: string, contentType: string): void { response.writeHead(statusCode, { "content-type": contentType, "cache-control": "no-store" }); response.end(body); }
function sendJson(response: ServerResponse, statusCode: number, body: unknown): void { send(response, statusCode, JSON.stringify(body), "application/json; charset=utf-8"); }
function listen(server: Server, port: number, host: string): Promise<number> { return new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, () => { server.off("error", reject); const address = server.address(); resolve(typeof address === "object" && address ? address.port : port); }); }); }
async function close(server: Server, host?: Host): Promise<void> { if (typeof host?.close === "function") await host.close().catch(() => undefined); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
