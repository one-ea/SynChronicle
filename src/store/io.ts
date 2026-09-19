import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

/**
 * P10 存储后端：默认文件系统；setStoreBackend(kv) 后全站读写路由到数据库 kv_files。
 * Store 层零改动——FileIO 契约保持一致（readJSON/readText/writeFile/appendJSONLine/remove/listDir）。
 */

export interface KvBackend {
  get(path: string): Promise<string | null>;
  set(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

let kvBackend: KvBackend | null = null;

export function setStoreBackend(kv: KvBackend | null): void { kvBackend = kv; }
export function storeBackend(): KvBackend | null { return kvBackend; }

function virtualKey(dir: string, rel: string): string {
  return join(dir || ".", rel).replace(/\\/g, "/").replace(/^\.\//, "");
}

export class FileIO {
  constructor(readonly dir: string) {}
  path(rel: string) { return kvBackend ? virtualKey(this.dir, rel) : join(this.dir, rel); }
  async ensureDirs(_dirs: string[]) { if (!kvBackend) await Promise.all(_dirs.map((dir) => mkdir(this.path(dir), { recursive: true }))); }
  async readFile(rel: string) {
    if (kvBackend) { const content = await kvBackend.get(virtualKey(this.dir, rel)); if (content === null) throw Object.assign(new Error(`ENOENT: ${rel}`), { code: "ENOENT" }); return Buffer.from(content, "utf8"); }
    return readFile(this.path(rel));
  }
  async readText(rel: string) { try { return await (await this.readFile(rel)).toString("utf8"); } catch (error) { if (isMissing(error)) return ""; throw error; } }
  async readJSON<T>(rel: string, schema?: z.ZodType<T>): Promise<T | null> {
    try {
      const value: unknown = JSON.parse(await this.readFile(rel).then((buffer) => buffer.toString("utf8")));
      return schema ? schema.parse(value) : value as T;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }
  async writeFile(rel: string, data: string | Uint8Array) {
    const content = typeof data === "string" ? data : Buffer.from(data).toString("utf8");
    if (kvBackend) return kvBackend.set(virtualKey(this.dir, rel), content);
    await atomicWrite(this.path(rel), data);
  }
  async writeJSON(rel: string, value: unknown) { await this.writeFile(rel, JSON.stringify(value, null, 2)); }
  async appendJSONLine(rel: string, value: unknown) {
    const line = `${JSON.stringify(value)}\n`;
    if (kvBackend) { const key = virtualKey(this.dir, rel); const current = (await kvBackend.get(key)) ?? ""; return kvBackend.set(key, current + line); }
    const path = this.path(rel);
    await mkdir(dirname(path), { recursive: true });
    const handle = await open(path, "a", 0o644);
    try { await handle.write(line); await handle.sync(); } finally { await handle.close(); }
  }
  async remove(rel: string) { if (kvBackend) return kvBackend.delete(virtualKey(this.dir, rel)); await rm(this.path(rel), { force: true, recursive: true }); }
  /** 列出目录下直接子项名称（文件与目录），数据库后端按 key 前缀推导。 */
  async listDir(rel: string): Promise<string[]> {
    if (kvBackend) {
      const prefix = virtualKey(this.dir, rel).replace(/\/$/, "") + "/";
      const names = new Set<string>();
      for (const key of await kvBackend.list(prefix)) names.add(key.slice(prefix.length).split("/")[0]!);
      return [...names];
    }
    const entries = await readdir(this.path(rel), { withFileTypes: true }).catch(() => []);
    return entries.map((entry) => entry.name);
  }
}

export class RecordingFileIO extends FileIO {
  private readonly writes = new Map<string, Uint8Array>();
  private readonly removed = new Set<string>();
  constructor(private readonly base: FileIO) { super(base.dir); }
  override async readFile(rel: string) { if (this.removed.has(rel)) throw Object.assign(new Error(`ENOENT: ${rel}`), { code: "ENOENT" }); const value = this.writes.get(rel); return value ? Buffer.from(value) : this.base.readFile(rel); }
  override async readText(rel: string) { try { return (await this.readFile(rel)).toString("utf8"); } catch (error) { if (isMissing(error)) return ""; throw error; } }
  override async readJSON<T>(rel: string, schema?: z.ZodType<T>): Promise<T | null> { const text = await this.readText(rel); if (!text) return null; const value: unknown = JSON.parse(text); return schema ? schema.parse(value) : value as T; }
  override async writeFile(rel: string, data: string | Uint8Array) { this.removed.delete(rel); this.writes.set(rel, Buffer.from(data)); }
  override async appendJSONLine(rel: string, value: unknown) { await this.writeFile(rel, `${await this.readText(rel)}${JSON.stringify(value)}\n`); }
  override async remove(rel: string) { this.writes.delete(rel); this.removed.add(rel); }
  artifacts() { return [...this.writes.entries()].map(([target, content]) => ({ target, content: Buffer.from(content) })).sort((a, b) => Number(a.target === "meta/checkpoints.jsonl") - Number(b.target === "meta/checkpoints.jsonl")); }
}

export async function atomicWrite(path: string, data: string | Uint8Array) {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(dirname(path), `${path.split("/").at(-1)}.tmp-${randomUUID()}`);
  const handle = await open(temp, "w", 0o644);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temp, path); } catch (error) { await rm(temp, { force: true }); throw error; }
}

export function parseJSONLines<T>(text: string, schema?: z.ZodType<T>, tolerateInvalid = false): T[] {
  const result: T[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { const value: unknown = JSON.parse(line); result.push(schema ? schema.parse(value) : value as T); }
    catch (error) { if (!tolerateInvalid) throw error; }
  }
  return result;
}

export function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
