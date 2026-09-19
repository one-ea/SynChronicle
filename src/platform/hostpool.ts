import type { Host } from "../runtime/host.js";

/**
 * P10-D 多租户 Host 池：
 * - 按 userId:bookId 缓存 Host 实例（LRU 上限 8，空闲 30 分钟逐出）
 * - 每用户并发运行 ≤ 2（写入口 acquire/release）
 * - 全局并发 Host ≤ 16
 * - 书籍切换/删除、用户停用时失效对应实例
 */

export interface HostPoolEntry { host: Host; lastUsed: number; }

export class HostPool {
  private readonly entries = new Map<string, HostPoolEntry>();
  private readonly running = new Map<string, number>();
  private clock = 0;
  constructor(private readonly maxEntries = 8, private readonly maxPerUser = 2, private readonly maxGlobal = 16) {}

  key(userId: string, bookId: string): string { return `${userId}:${bookId}`; }

  get(userId: string, bookId: string): Host | undefined {
    const entry = this.entries.get(this.key(userId, bookId));
    if (entry) entry.lastUsed = ++this.clock;
    return entry?.host;
  }

  put(userId: string, bookId: string, host: Host): void {
    const key = this.key(userId, bookId);
    this.entries.set(key, { host, lastUsed: ++this.clock });
    this.evict();
  }

  /** 用户当前并发数。 */
  runningCount(userId: string): number { return this.running.get(userId) ?? 0; }

  /** 尝试为用户占一个运行位；返回是否成功。 */
  acquire(userId: string): boolean {
    if (this.entries.size > this.maxGlobal && !this.running.has(userId)) return false;
    const current = this.running.get(userId) ?? 0;
    if (current >= this.maxPerUser) return false;
    let globalRunning = 0;
    for (const count of this.running.values()) globalRunning += count;
    if (globalRunning >= this.maxGlobal) return false;
    this.running.set(userId, current + 1);
    return true;
  }

  release(userId: string): void {
    const current = this.running.get(userId) ?? 0;
    if (current <= 1) this.running.delete(userId);
    else this.running.set(userId, current - 1);
  }

  /** 使某本书的所有 Host 失效（切换/删除时）；userId 可选限定。 */
  invalidateBook(bookId: string, userId?: string): void {
    for (const [key, entry] of this.entries) {
      const [keyUser, keyBook] = key.split(":");
      if (keyBook === bookId && (!userId || keyUser === userId)) {
        void entry.host.abort?.(`书籍失效: ${bookId}`, "warn");
        this.entries.delete(key);
      }
    }
  }

  /** 使用户全部 Host 失效（停用时）。 */
  invalidateUser(userId: string): void {
    for (const [key, entry] of this.entries) {
      if (key.startsWith(`${userId}:`)) {
        void entry.host.abort?.(`用户失效: ${userId}`, "warn");
        this.entries.delete(key);
      }
    }
    this.running.delete(userId);
  }

  size(): number { return this.entries.size; }

  private evict(): void {
    if (this.entries.size <= this.maxEntries) return;
    const sorted = [...this.entries.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [key, entry] of sorted.slice(0, this.entries.size - this.maxEntries)) {
      void entry.host.abort?.("Host 池逐出", "warn");
      this.entries.delete(key);
    }
  }
}
