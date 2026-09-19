import type { SqlDatabase } from "../db/sql.js";

/** P10-B 渠道与额度 DAO：channels / channel_grants / usage_ledger / recharge_codes。 */

export interface ChannelRow {
  id: string; owner_id: string | null; name: string; provider: string; base_url: string;
  api_key_ct: string; api_key_iv: string; api_key_tag: string;
  models: string; weight: number; status: string; created_at: string;
}
export interface GrantRow { channel_id: string; user_id: string; granted_at: string; }
export interface LedgerRow { id?: number; user_id: string; book_id: string | null; agent: string; tokens_in: number; tokens_out: number; cost_usd: number; created_at: string; }

const CHANNEL_SELECT = "SELECT id, owner_id, name, provider, base_url, api_key_ct, api_key_iv, api_key_tag, models, weight, status, created_at FROM channels";

export class ChannelsDao {
  constructor(private readonly db: SqlDatabase) {}

  async create(row: ChannelRow): Promise<void> {
    await this.db.run("INSERT INTO channels (id, owner_id, name, provider, base_url, api_key_ct, api_key_iv, api_key_tag, models, weight, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [row.id, row.owner_id, row.name, row.provider, row.base_url, row.api_key_ct, row.api_key_iv, row.api_key_tag, row.models, row.weight, row.status, row.created_at]);
  }

  async get(id: string): Promise<ChannelRow | null> { return this.db.get<ChannelRow>(`${CHANNEL_SELECT} WHERE id = ?`, [id]); }

  async listForOwner(ownerId: string): Promise<ChannelRow[]> { return this.db.all<ChannelRow>(`${CHANNEL_SELECT} WHERE owner_id = ? ORDER BY created_at`, [ownerId]); }

  async listAdminPool(): Promise<ChannelRow[]> { return this.db.all<ChannelRow>(`${CHANNEL_SELECT} WHERE owner_id IS NULL ORDER BY created_at`); }

  async listAll(): Promise<ChannelRow[]> { return this.db.all<ChannelRow>(`${CHANNEL_SELECT} ORDER BY created_at`); }

  async remove(id: string): Promise<void> { await this.db.run("DELETE FROM channel_grants WHERE channel_id = ?", [id]); await this.db.run("DELETE FROM channels WHERE id = ?", [id]); }

  async setStatus(id: string, status: string): Promise<void> { await this.db.run("UPDATE channels SET status = ? WHERE id = ?", [status, id]); }

  async saveSecret(id: string, ct: string, iv: string, tag: string): Promise<void> { await this.db.run("UPDATE channels SET api_key_ct = ?, api_key_iv = ?, api_key_tag = ? WHERE id = ?", [ct, iv, tag, id]); }

  async grant(channelId: string, userId: string, now: string): Promise<void> {
    if (this.db.dialect === "mysql") return void (await this.db.run("INSERT IGNORE INTO channel_grants (channel_id, user_id, granted_at) VALUES (?, ?, ?)", [channelId, userId, now]));
    await this.db.run("INSERT INTO channel_grants (channel_id, user_id, granted_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", [channelId, userId, now]);
  }

  async revoke(channelId: string, userId: string): Promise<void> { await this.db.run("DELETE FROM channel_grants WHERE channel_id = ? AND user_id = ?", [channelId, userId]); }

  async listGrants(channelId: string): Promise<GrantRow[]> { return this.db.all<GrantRow>("SELECT channel_id, user_id, granted_at FROM channel_grants WHERE channel_id = ?", [channelId]); }

  async listGrantedIds(userId: string): Promise<string[]> { return (await this.db.all<{ channel_id: string }>("SELECT channel_id FROM channel_grants WHERE user_id = ?", [userId])).map((row: { channel_id: string }) => row.channel_id); }

  /** 用户可用渠道 = 自有 active + 已授权 admin 池 active。 */
  async effective(userId: string): Promise<ChannelRow[]> {
    const own = await this.listForOwner(userId);
    const grantedIds = new Set(await this.listGrantedIds(userId));
    const pool = (await this.listAdminPool()).filter((channel) => grantedIds.has(channel.id));
    return [...own, ...pool].filter((channel) => channel.status === "active");
  }
}

export class QuotaDao {
  constructor(private readonly db: SqlDatabase) {}

  async balance(userId: string): Promise<{ remaining: number; used: number }> {
    const row = await this.db.get<{ quota_usd_remaining: number; quota_usd_used: number }>("SELECT quota_usd_remaining, quota_usd_used FROM users WHERE id = ?", [userId]);
    return { remaining: Number(row?.quota_usd_remaining ?? 0), used: Number(row?.quota_usd_used ?? 0) };
  }

  /** 原子扣减：余额不足返回 false（不产生负债）。 */
  async settle(userId: string, entry: Omit<LedgerRow, "id">): Promise<boolean> {
    await this.db.run("INSERT INTO usage_ledger (user_id, book_id, agent, tokens_in, tokens_out, cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [entry.user_id, entry.book_id, entry.agent, entry.tokens_in, entry.tokens_out, entry.cost_usd, entry.created_at]);
    const result = await this.db.run("UPDATE users SET quota_usd_remaining = quota_usd_remaining - ?, quota_usd_used = quota_usd_used + ? WHERE id = ? AND quota_usd_remaining >= ?", [entry.cost_usd, entry.cost_usd, userId, entry.cost_usd]);
    void result;
    const after = await this.balance(userId);
    return after.remaining >= 0 && after.used >= 0;
  }

  async grantQuota(userId: string, amountUsd: number): Promise<void> { await this.db.run("UPDATE users SET quota_usd_remaining = quota_usd_remaining + ? WHERE id = ?", [amountUsd, userId]); }

  async ledger(userId: string, limit = 50): Promise<LedgerRow[]> { return this.db.all<LedgerRow>("SELECT id, user_id, book_id, agent, tokens_in, tokens_out, cost_usd, created_at FROM usage_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?", [userId, limit]); }

  async dailySummary(userId: string): Promise<Array<{ day: string; cost_usd: number }>> { return this.db.all<{ day: string; cost_usd: number }>("SELECT substr(created_at, 1, 10) AS day, SUM(cost_usd) AS cost_usd FROM usage_ledger WHERE user_id = ? GROUP BY day ORDER BY day DESC LIMIT 30", [userId]); }

  async createRechargeCode(code: string, amountUsd: number, issuedBy: string): Promise<void> { await this.db.run("INSERT INTO recharge_codes (code, amount_usd, issued_by, used_by, used_at) VALUES (?, ?, ?, NULL, NULL)", [code, amountUsd, issuedBy]); }

  async listRechargeCodes(): Promise<Array<{ code: string; amount_usd: number; issued_by: string; used_by: string | null; used_at: string | null }>> { return this.db.all("SELECT code, amount_usd, issued_by, used_by, used_at FROM recharge_codes ORDER BY code"); }

  /** 原子兑换：仅当未使用时核销并加额。 */
  async redeem(code: string, userId: string, now: string): Promise<{ ok: boolean; amountUsd: number }> {
    const row = await this.db.get<{ amount_usd: number }>("SELECT amount_usd FROM recharge_codes WHERE code = ? AND used_by IS NULL", [code]);
    if (!row) return { ok: false, amountUsd: 0 };
    await this.db.run("UPDATE recharge_codes SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL", [userId, now, code]);
    await this.grantQuota(userId, Number(row.amount_usd));
    return { ok: true, amountUsd: Number(row.amount_usd) };
  }
}
