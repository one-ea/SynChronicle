import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { DatabaseUrl, SqlDatabase } from "./sql-core.js";

/**
 * P10 平台数据层：跨方言 SQL 适配（Node 侧驱动）。
 * sqlite（默认，better-sqlite3）/ postgres（pg）/ mysql（mysql2）。
 * 占位符统一写 `?`，pg 方言自动转换为 `$n`。
 * 类型与 ensureSchema 在 sql-core.ts（无 Node 依赖，Worker 复用）。
 */

export type { DatabaseUrl, SqlDatabase };
export { ensureSchema } from "./sql-core.js";

export function parseDatabaseUrl(url: string): DatabaseUrl {
  if (url.startsWith("sqlite:")) return { dialect: "sqlite", target: url.slice("sqlite:".length) };
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) return { dialect: "postgres", target: url };
  if (url.startsWith("mysql://")) return { dialect: "mysql", target: url };
  throw new Error(`不支持的 DATABASE_URL: ${url}（支持 sqlite: / postgres:// / mysql://）`);
}

export async function openDatabase(url: string): Promise<SqlDatabase> {
  const parsed = parseDatabaseUrl(url);
  if (parsed.dialect === "sqlite") return openSqlite(parsed.target);
  if (parsed.dialect === "postgres") return openPostgres(parsed.target);
  return openMysql(parsed.target);
}

async function openSqlite(target: string): Promise<SqlDatabase> {
  if (target && target !== ":memory:") await mkdir(dirname(target), { recursive: true });
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(target || ":memory:");
  db.pragma("journal_mode = WAL");
  return {
    dialect: "sqlite",
    async run(sql, params = []) { db.prepare(sql).run(...params); },
    async get<T>(sql: string, params: unknown[] = []) { return (db.prepare(sql).get(...params) ?? null) as T | null; },
    async all<T>(sql: string, params: unknown[] = []) { return db.prepare(sql).all(...params) as T[]; },
    async close() { db.close(); },
  };
}

async function openPostgres(target: string): Promise<SqlDatabase> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: target });
  return {
    dialect: "postgres",
    async run(sql, params = []) { await pool.query(toPg(sql), params); },
    async get<T>(sql: string, params: unknown[] = []) { const result = await pool.query(toPg(sql), params); return (result.rows[0] ?? null) as T | null; },
    async all<T>(sql: string, params: unknown[] = []) { const result = await pool.query(toPg(sql), params); return result.rows as T[]; },
    async close() { await pool.end(); },
  };
}

async function openMysql(target: string): Promise<SqlDatabase> {
  const mysql = await import("mysql2/promise");
  const pool = mysql.createPool(target);
  return {
    dialect: "mysql",
    async run(sql, params = []) { await pool.query({ sql, values: params }); },
    async get<T>(sql: string, params: unknown[] = []) { const [rows] = await pool.query({ sql, values: params }); return ((rows as unknown[])[0] ?? null) as T | null; },
    async all<T>(sql: string, params: unknown[] = []) { const [rows] = await pool.query({ sql, values: params }); return rows as T[]; },
    async close() { await pool.end(); },
  };
}

function toPg(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}
