import { readdir, readFile, stat } from "node:fs/promises";
import { join, posix, resolve } from "node:path";
import { UsersFileSchema, type UserRecord } from "../domain/user.js";
import { SqlKV } from "./kv.js";
import { UsersDao, type UserRow } from "./users.js";
import { ensureSchema, openDatabase, type SqlDatabase } from "./sql.js";

/**
 * P10-A 迁移工具：把 v2 文件工作区导入数据库（幂等）。
 * - users.json → users 表（按 id 去重）
 * - 其余全部文件（bookshelf.json、published.json、各书目录、.auth_secret）→ kv_files
 * - verify：文件树与数据库两侧的书数/章数/字数总量对比
 */

export interface MigrationStats { filesImported: number; filesSkipped: number; usersImported: number; usersSkipped: number; }

async function walk(root: string, rel = ""): Promise<string[]> {
  const entries = await readdir(join(root, rel), { withFileTypes: true }).catch(() => []);
  const paths: string[] = [];
  for (const entry of entries) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) paths.push(...(await walk(root, child)));
    else if (entry.isFile()) paths.push(child);
  }
  return paths;
}

export async function migrateFiles(booksRoot: string, dbUrl: string): Promise<MigrationStats> {
  const db: SqlDatabase = await openDatabase(dbUrl);
  try {
    await ensureSchema(db);
    const kv = new SqlKV(db);
    const users = new UsersDao(db);
    const stats: MigrationStats = { filesImported: 0, filesSkipped: 0, usersImported: 0, usersSkipped: 0 };
    const absoluteRoot = resolve(booksRoot);
    const files = await walk(booksRoot);
    for (const rel of files.sort()) {
      const key = posix.join(absoluteRoot, posix.normalize(rel));
      const content = await readFile(join(booksRoot, rel), "utf8").catch(() => null);
      if (content === null) continue;
      if (posix.normalize(rel) === "users.json") {
        const parsed = UsersFileSchema.safeParse(JSON.parse(content));
        if (!parsed.success) continue;
        const existingIds = new Set((await users.list()).map((row) => row.id));
        for (const user of parsed.data.users as UserRecord[]) {
          if (existingIds.has(user.id)) { stats.usersSkipped += 1; continue; }
          await users.upsert(toRow(user));
          stats.usersImported += 1;
        }
        continue;
      }
      if ((await kv.get(key)) === null) { await kv.set(key, content); stats.filesImported += 1; }
      else stats.filesSkipped += 1;
    }
    return stats;
  } finally { await db.close(); }
}

export interface VerifyReport { ok: boolean; files: { fs: number; db: number }; books: { fs: number; db: number }; chapters: { fs: number; db: number }; words: { fs: number; db: number }; }

export async function verifyMigration(booksRoot: string, dbUrl: string): Promise<VerifyReport> {
  const db = await openDatabase(dbUrl);
  try {
    await ensureSchema(db);
    const kv = new SqlKV(db);
    const absoluteRoot = resolve(booksRoot);
    const fsFiles = (await walk(booksRoot)).map((rel) => posix.normalize(rel)).filter((rel) => rel !== "users.json");
    const dbKeys = (await kv.list("")).filter((key) => key.startsWith(`${absoluteRoot}/`) && key !== "users.json");
    const shelfKey = `${absoluteRoot}/bookshelf.json`;
    const report: VerifyReport = { ok: true, files: { fs: fsFiles.length, db: dbKeys.length }, books: { fs: 0, db: 0 }, chapters: { fs: 0, db: 0 }, words: { fs: 0, db: 0 } };
    const shelfRaw = await kv.get(shelfKey);
    const shelf = shelfRaw ? JSON.parse(shelfRaw) as { books?: Array<{ id: string }> } : null;
    const bookIds = shelf?.books?.map((book) => book.id) ?? [];
    report.books.db = bookIds.length;
    const fsShelfFile = fsFiles.includes("bookshelf.json") ? JSON.parse(await readFile(join(booksRoot, "bookshelf.json"), "utf8")) as { books?: Array<{ id: string }> } : null;
    report.books.fs = fsShelfFile?.books?.length ?? 0;
    for (const bookId of bookIds) {
      const progressKey = `${absoluteRoot}/${bookId}/meta/progress.json`;
      report.chapters.db += await chapterCount(kv, progressKey);
      report.words.db += await wordTotal(kv, progressKey);
      const fsProgress = join(booksRoot, bookId, "meta", "progress.json");
      if (await stat(fsProgress).then(() => true, () => false)) {
        const progress = JSON.parse(await readFile(fsProgress, "utf8")) as { completed_chapters?: number[]; total_word_count?: number };
        report.chapters.fs += progress.completed_chapters?.length ?? 0;
        report.words.fs += progress.total_word_count ?? 0;
      }
    }
    report.ok = report.files.fs === report.files.db && report.books.fs === report.books.db && report.chapters.fs === report.chapters.db && report.words.fs === report.words.db;
    return report;
  } finally { await db.close(); }
}

async function chapterCount(kv: SqlKV, progressPath: string): Promise<number> {
  const raw = await kv.get(progressPath);
  if (!raw) return 0;
  return (JSON.parse(raw) as { completed_chapters?: number[] }).completed_chapters?.length ?? 0;
}

async function wordTotal(kv: SqlKV, progressPath: string): Promise<number> {
  const raw = await kv.get(progressPath);
  if (!raw) return 0;
  return (JSON.parse(raw) as { total_word_count?: number }).total_word_count ?? 0;
}

function toRow(user: UserRecord): UserRow {
  const now = new Date().toISOString();
  return {
    id: user.id, name: user.name, password_salt: user.salt, password_hash: user.hash,
    role: user.role, status: user.disabled ? "disabled" : "active",
    quota_usd_remaining: 0, quota_usd_used: 0, created_at: user.createdAt, updated_at: now,
  };
}

export async function migrateFilesCommand(booksRoot: string, dbUrl: string): Promise<number> {
  const stats = await migrateFiles(booksRoot, dbUrl);
  process.stdout.write(`迁移完成：文件导入 ${stats.filesImported} / 跳过 ${stats.filesSkipped}，用户导入 ${stats.usersImported} / 跳过 ${stats.usersSkipped}\n`);
  return 0;
}

export async function verifyMigrationCommand(booksRoot: string, dbUrl: string): Promise<number> {
  const report = await verifyMigration(booksRoot, dbUrl);
  process.stdout.write(`文件 fs=${report.files.fs} db=${report.files.db}；书 fs=${report.books.fs} db=${report.books.db}；章 fs=${report.chapters.fs} db=${report.chapters.db}；字数 fs=${report.words.fs} db=${report.words.db}\n`);
  if (!report.ok) { process.stderr.write("校验失败：文件工作区与数据库不一致\n"); return 1; }
  process.stdout.write("校验通过\n");
  return 0;
}
