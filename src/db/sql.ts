import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * P10 平台数据层：跨方言 SQL 适配。
 * sqlite（默认，better-sqlite3）/ postgres（pg）/ mysql（mysql2）。
 * 占位符统一写 `?`，pg 方言自动转换为 `$n`。
 */

export interface SqlDatabase {
  readonly dialect: "sqlite" | "postgres" | "mysql";
  run(sql: string, params?: unknown[]): Promise<void>;
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

export interface DatabaseUrl { dialect: "sqlite" | "postgres" | "mysql"; target: string; }

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

/** 幂等建表（三方言可移植 DDL）。 */
export async function ensureSchema(db: SqlDatabase): Promise<void> {
  const text = db.dialect === "mysql" ? "LONGTEXT" : "TEXT";
  const real = db.dialect === "sqlite" ? "REAL" : "DOUBLE PRECISION";
  const nameType = db.dialect === "mysql" ? "VARCHAR(64)" : "TEXT";
  await db.run(`CREATE TABLE IF NOT EXISTS kv_files (path ${nameType} PRIMARY KEY, content ${text} NOT NULL, updated_at ${nameType} NOT NULL)`);
  await db.run(`CREATE TABLE IF NOT EXISTS users (id ${nameType} PRIMARY KEY, name ${nameType} NOT NULL UNIQUE, password_salt ${nameType} NOT NULL, password_hash ${nameType} NOT NULL, role ${nameType} NOT NULL, status ${nameType} NOT NULL, quota_usd_remaining ${real} NOT NULL DEFAULT 0, quota_usd_used ${real} NOT NULL DEFAULT 0, created_at ${nameType} NOT NULL, updated_at ${nameType} NOT NULL)`);
  await db.run(`CREATE TABLE IF NOT EXISTS invite_codes (code ${nameType} PRIMARY KEY, granted_usd ${real} NOT NULL, issued_by ${nameType} NOT NULL, used_by ${nameType}, used_at ${nameType}, expires_at ${nameType})`);
  await db.run(`CREATE TABLE IF NOT EXISTS recharge_codes (code ${nameType} PRIMARY KEY, amount_usd ${real} NOT NULL, issued_by ${nameType} NOT NULL, used_by ${nameType}, used_at ${nameType})`);
}
