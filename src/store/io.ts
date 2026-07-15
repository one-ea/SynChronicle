import { mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export class FileIO {
  readonly usesFilesystemPaths: boolean = true;
  constructor(readonly dir: string) {}
  lockKey() { return realpath(this.dir); }
  path(rel: string) { return join(this.dir, rel); }
  async ensureDirs(dirs: string[]) { await Promise.all(dirs.map((dir) => mkdir(this.path(dir), { recursive: true }))); }
  async readFile(rel: string) { return readFile(this.path(rel)); }
  async readText(rel: string) { try { return await readFile(this.path(rel), "utf8"); } catch (error) { if (isMissing(error)) return ""; throw error; } }
  async readJSON<T>(rel: string, schema?: z.ZodType<T>): Promise<T | null> {
    try {
      const value: unknown = JSON.parse(await readFile(this.path(rel), "utf8"));
      return schema ? schema.parse(value) : value as T;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }
  async writeFile(rel: string, data: string | Uint8Array) { await atomicWrite(this.path(rel), data); }
  async writeJSON(rel: string, value: unknown) { await this.writeFile(rel, JSON.stringify(value, null, 2)); }
  async appendJSONLine(rel: string, value: unknown) {
    const path = this.path(rel);
    await mkdir(dirname(path), { recursive: true });
    const handle = await open(path, "a", 0o644);
    try { await handle.write(`${JSON.stringify(value)}\n`); await handle.sync(); } finally { await handle.close(); }
  }
  async remove(rel: string) { await rm(this.path(rel), { force: true, recursive: true }); }
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
