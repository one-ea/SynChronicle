/**
 * 跨方言 SQL 类型与可移植 DDL：无 Node 依赖，可进入 Worker 打包图。
 * Node 侧 openDatabase 在 sql.ts；D1 侧适配器在 worker/index.ts。
 */

export interface SqlDatabase {
  readonly dialect: "sqlite" | "postgres" | "mysql";
  /** 返回受影响行数：幂等抢占（UPDATE ... WHERE 未用）依赖它区分命中/未命中。 */
  run(sql: string, params?: unknown[]): Promise<number>;
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

export interface DatabaseUrl { dialect: "sqlite" | "postgres" | "mysql"; target: string; }

/** 幂等建表（三方言可移植 DDL；D1 走 sqlite 分支）。 */
export async function ensureSchema(db: SqlDatabase): Promise<void> {
  const text = db.dialect === "mysql" ? "LONGTEXT" : "TEXT";
  const real = db.dialect === "sqlite" ? "REAL" : "DOUBLE PRECISION";
  const nameType = db.dialect === "mysql" ? "VARCHAR(64)" : "TEXT";
  // kv_files.path 存绝对路径（含 reflection UUID 工件可达 120+ 字符），MySQL 下 64 会截断互相覆盖
  const pathType = db.dialect === "mysql" ? "VARCHAR(512)" : "TEXT";
  await db.run(`CREATE TABLE IF NOT EXISTS kv_files (path ${pathType} PRIMARY KEY, content ${text} NOT NULL, updated_at ${nameType} NOT NULL)`);
  await db.run(`CREATE TABLE IF NOT EXISTS users (id ${nameType} PRIMARY KEY, name ${nameType} NOT NULL UNIQUE, password_salt ${nameType} NOT NULL, password_hash ${nameType} NOT NULL, role ${nameType} NOT NULL, status ${nameType} NOT NULL, quota_usd_remaining ${real} NOT NULL DEFAULT 0, quota_usd_used ${real} NOT NULL DEFAULT 0, created_at ${nameType} NOT NULL, updated_at ${nameType} NOT NULL)`);
  await db.run(`CREATE TABLE IF NOT EXISTS invite_codes (code ${nameType} PRIMARY KEY, granted_usd ${real} NOT NULL, issued_by ${nameType} NOT NULL, used_by ${nameType}, used_at ${nameType}, expires_at ${nameType})`);
  await db.run(`CREATE TABLE IF NOT EXISTS recharge_codes (code ${nameType} PRIMARY KEY, amount_usd ${real} NOT NULL, issued_by ${nameType} NOT NULL, used_by ${nameType}, used_at ${nameType})`);
  await db.run(`CREATE TABLE IF NOT EXISTS channels (id ${nameType} PRIMARY KEY, owner_id ${nameType}, name ${nameType} NOT NULL, provider ${nameType} NOT NULL, base_url ${nameType} NOT NULL, api_key_ct ${text} NOT NULL, api_key_iv ${nameType} NOT NULL, api_key_tag ${nameType} NOT NULL, models ${text} NOT NULL, weight ${real} NOT NULL DEFAULT 1, status ${nameType} NOT NULL, created_at ${nameType} NOT NULL)`);
  await db.run(`CREATE TABLE IF NOT EXISTS channel_grants (channel_id ${nameType} NOT NULL, user_id ${nameType} NOT NULL, granted_at ${nameType} NOT NULL, PRIMARY KEY (channel_id, user_id))`);
  const ledgerId = db.dialect === "sqlite" ? "id INTEGER PRIMARY KEY AUTOINCREMENT" : db.dialect === "postgres" ? "id BIGSERIAL PRIMARY KEY" : "id BIGINT PRIMARY KEY AUTO_INCREMENT";
  await db.run(`CREATE TABLE IF NOT EXISTS usage_ledger (${ledgerId}, user_id ${nameType} NOT NULL, book_id ${nameType}, agent ${nameType} NOT NULL, tokens_in ${real} NOT NULL DEFAULT 0, tokens_out ${real} NOT NULL DEFAULT 0, cost_usd ${real} NOT NULL DEFAULT 0, created_at ${nameType} NOT NULL)`);
  await db.run(`CREATE TABLE IF NOT EXISTS audit_logs (${ledgerId}, actor_id ${nameType} NOT NULL, action ${nameType} NOT NULL, target ${nameType} NOT NULL, detail ${text}, created_at ${nameType} NOT NULL)`);
  await db.run(`CREATE TABLE IF NOT EXISTS reports (${ledgerId}, entry_id ${nameType} NOT NULL, note ${text}, status ${nameType} NOT NULL DEFAULT 'open', handled_by ${nameType}, created_at ${nameType} NOT NULL)`);
  // 旧 MySQL 部署的 path 仍是 VARCHAR(64)，幂等扩容（新部署与失败均安全跳过）
  if (db.dialect === "mysql") await db.run("ALTER TABLE kv_files MODIFY COLUMN path VARCHAR(512) NOT NULL").catch(() => undefined);
}
