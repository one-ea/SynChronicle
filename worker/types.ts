/**
 * Cloudflare Workers 环境绑定。
 * D1 承载数据表；KV 承载书稿文件（kv_files 语义）；Secrets 注入 MASTER_KEY。
 */

export interface Env {
  /** D1 数据库绑定（wrangler.toml d1_databases）。 */
  DB: D1Database;
  /** RuntimeHub Durable Object 绑定：每 userId:bookId 一个实例，承载 SSE 与事件回放。 */
  RUNTIME: DurableObjectNamespace;
  /** 内部事件摄入令牌（Node 主线边缘中继使用）；未配置时 /api/internal/events 拒绝写入。 */
  INTERNAL_TOKEN?: string;
  /** KV 命名空间绑定，存放书稿内容（key 与 Node 版 kv_files 绝对路径键一致）。 */
  CONTENT: KVNamespace;
  /** R2 桶绑定（可选）：导出文件存储；未绑定时导出返回内联文本。 */
  EXPORTS?: R2Bucket;
  /** 信封加密主密钥（64 位 hex），wrangler secret put MASTER_KEY。 */
  MASTER_KEY: string;
  /** 平台模式：selfhost（默认）| commercial。 */
  MODE?: string;
  /** 可选鉴权会话签名密钥；缺省时从 KV 派生并持久化。 */
  AUTH_SECRET?: string;
}

/** Worker 运行上下文：预初始化的 DAO 集合。 */
export interface WorkerContext {
  env: Env;
  db: D1Database;
  kv: D1KvStore;
  mode: "selfhost" | "commercial";
}

/** kv_files 语义存储接口（与 src/store/io.ts KvBackend 保持一致，避免引入 node:fs）。 */
export interface KvBackend {
  get(path: string): Promise<string | null>;
  set(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

/** D1 实现的 kv_files 语义存储。 */
export class D1KvStore implements KvBackend {
  constructor(private readonly db: D1Database) {}

  async get(path: string): Promise<string | null> {
    const { results } = await this.db.prepare("SELECT content FROM kv_files WHERE path = ?1").bind(path).all<{ content: string }>();
    return results[0]?.content ?? null;
  }

  async set(path: string, content: string): Promise<void> {
    await this.db.prepare(
      "INSERT INTO kv_files (path, content, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(path) DO UPDATE SET content = ?2, updated_at = ?3",
    ).bind(path, content, new Date().toISOString()).run();
  }

  async delete(path: string): Promise<void> {
    await this.db.prepare("DELETE FROM kv_files WHERE path = ?1").bind(path).run();
  }

  async list(prefix: string): Promise<string[]> {
    const { results } = await this.db.prepare("SELECT path FROM kv_files WHERE path LIKE ?1 ORDER BY path").bind(`${prefix}%`).all<{ path: string }>();
    return results.map((row) => row.path);
  }
}
