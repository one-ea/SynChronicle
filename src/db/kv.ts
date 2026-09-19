import type { KvBackend } from "../store/io.js";
import type { SqlDatabase } from "./sql.js";

/** kv_files 表适配器：把数据库当作路径寻址的内容存储。 */
export class SqlKV implements KvBackend {
  constructor(private readonly db: SqlDatabase) {}

  async get(path: string): Promise<string | null> {
    const row = await this.db.get<{ content: string }>("SELECT content FROM kv_files WHERE path = ?", [path]);
    return row?.content ?? null;
  }

  async set(path: string, content: string): Promise<void> {
    const now = new Date().toISOString();
    if (this.db.dialect === "mysql") {
      await this.db.run("INSERT INTO kv_files (path, content, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE content = VALUES(content), updated_at = VALUES(updated_at)", [path, content, now]);
      return;
    }
    await this.db.run("INSERT INTO kv_files (path, content, updated_at) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at", [path, content, now]);
  }

  async delete(path: string): Promise<void> { await this.db.run("DELETE FROM kv_files WHERE path = ?", [path]); }

  async list(prefix: string): Promise<string[]> {
    const rows = await this.db.all<{ path: string }>("SELECT path FROM kv_files WHERE path LIKE ? ORDER BY path", [`${prefix}%`]);
    return rows.map((row) => row.path);
  }

  async count(): Promise<number> { const row = await this.db.get<{ total: number }>("SELECT COUNT(*) AS total FROM kv_files"); return Number(row?.total ?? 0); }
}
