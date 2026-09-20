import type { SqlDatabase } from "./sql.js";

/**
 * 平台关系表 DAO：用户与邀请码（P10-A）。
 * 用户行结构与 UserRecord 对齐；quota 字段 P10-B 启用。
 */

export interface UserRow {
  id: string; name: string; password_salt: string; password_hash: string;
  role: string; status: string; quota_usd_remaining: number; quota_usd_used: number;
  created_at: string; updated_at: string;
}

export interface InviteRow { code: string; granted_usd: number; issued_by: string; used_by: string | null; used_at: string | null; expires_at: string | null; }

const USER_SELECT = "SELECT id, name, password_salt, password_hash, role, status, quota_usd_remaining, quota_usd_used, created_at, updated_at FROM users";

export class UsersDao {
  constructor(private readonly db: SqlDatabase) {}

  async list(): Promise<UserRow[]> { return this.db.all<UserRow>(`${USER_SELECT} ORDER BY created_at`); }

  async byId(id: string): Promise<UserRow | null> { return this.db.get<UserRow>(`${USER_SELECT} WHERE id = ?`, [id]); }

  async byName(name: string): Promise<UserRow | null> { return this.db.get<UserRow>(`${USER_SELECT} WHERE name = ?`, [name]); }

  async upsert(row: UserRow): Promise<void> {
    // sqlite 与 postgres 共用 ON CONFLICT 语法；仅 mysql 走 ON DUPLICATE KEY
    const upsertSql = this.db.dialect === "mysql"
      ? `INSERT INTO users (id, name, password_salt, password_hash, role, status, quota_usd_remaining, quota_usd_used, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), password_salt = VALUES(password_salt), password_hash = VALUES(password_hash), role = VALUES(role), status = VALUES(status), quota_usd_remaining = VALUES(quota_usd_remaining), quota_usd_used = VALUES(quota_usd_used), updated_at = VALUES(updated_at)`
      : `INSERT INTO users (id, name, password_salt, password_hash, role, status, quota_usd_remaining, quota_usd_used, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, password_salt = excluded.password_salt, password_hash = excluded.password_hash, role = excluded.role, status = excluded.status, quota_usd_remaining = excluded.quota_usd_remaining, quota_usd_used = excluded.quota_usd_used, updated_at = excluded.updated_at`;
    await this.db.run(upsertSql, [row.id, row.name, row.password_salt, row.password_hash, row.role, row.status, row.quota_usd_remaining, row.quota_usd_used, row.created_at, row.updated_at]);
  }

  async remove(id: string): Promise<void> { await this.db.run("DELETE FROM users WHERE id = ?", [id]); }

  async count(): Promise<number> { const row = await this.db.get<{ total: number }>("SELECT COUNT(*) AS total FROM users"); return Number(row?.total ?? 0); }

  /** 全量同步（saveUsers 语义）：upsert 传入行。不做删除——并发全量替换会互删用户，且当前业务只追加/修改。 */
  async sync(rows: UserRow[]): Promise<void> {
    for (const row of rows) await this.upsert(row);
  }

  async createInvite(code: string, grantedUsd: number, issuedBy: string, expiresAt: string | null): Promise<void> {
    await this.db.run("INSERT INTO invite_codes (code, granted_usd, issued_by, used_by, used_at, expires_at) VALUES (?, ?, ?, NULL, NULL, ?)", [code, grantedUsd, issuedBy, expiresAt]);
  }

  async listInvites(): Promise<InviteRow[]> { return this.db.all<InviteRow>("SELECT code, granted_usd, issued_by, used_by, used_at, expires_at FROM invite_codes ORDER BY code"); }

  /** 原子认领：仅当未使用时标记 used_by，按受影响行数判定是否抢占成功。 */
  async claimInvite(code: string, usedBy: string, now: string): Promise<{ ok: boolean; grantedUsd: number; expired: boolean }> {
    const row = await this.db.get<InviteRow>("SELECT code, granted_usd, issued_by, used_by, used_at, expires_at FROM invite_codes WHERE code = ?", [code]);
    if (!row) return { ok: false, grantedUsd: 0, expired: false };
    if (row.used_by) return { ok: false, grantedUsd: row.granted_usd, expired: false };
    if (row.expires_at && row.expires_at < now) return { ok: false, grantedUsd: row.granted_usd, expired: true };
    const affected = await this.db.run("UPDATE invite_codes SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL", [usedBy, now, code]);
    // SELECT 与 UPDATE 之间的 await 间隙可被并发请求插入，0 行命中说明已被他人抢占
    if (affected === 0) return { ok: false, grantedUsd: row.granted_usd, expired: false };
    return { ok: true, grantedUsd: row.granted_usd, expired: false };
  }
}
