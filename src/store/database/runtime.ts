import { z } from "zod";
import { CheckpointSchema, RuntimeQueueItemSchema, UsageStateSchema, type RuntimeQueueItem } from "../../domain/index.js";
import { FileIO, isMissing } from "../io.js";
import { parseJSONLines } from "../io.js";
import { RuntimeStore } from "../runtime.js";
import type { DatabaseBackend, DatabaseStoreScope } from "./artifacts.js";

export class DatabaseFileIO extends FileIO {
  override readonly usesFilesystemPaths = false;
  constructor(readonly scope: DatabaseStoreScope, readonly backend: DatabaseBackend) { super(`database://${scope.userId}/${scope.projectId}/${scope.runId}`); }
  override async ensureDirs(_dirs: string[]) {}
  override async lockKey() { return this.dir; }
  override async readFile(path: string) {
    if (path === "meta/runtime/queue.jsonl") { const values = await this.backend.loadRuntime(this.scope); return Buffer.from(values.map((value) => JSON.stringify(value)).join("\n") + (values.length ? "\n" : "")); }
    if (path === "meta/checkpoints.jsonl") { const values = await this.backend.loadCheckpoints(this.scope); return Buffer.from(values.map((value) => JSON.stringify(value)).join("\n") + (values.length ? "\n" : "")); }
    if (path === "meta/usage.json") { const value = await this.backend.loadUsage(this.scope); if (value) return Buffer.from(JSON.stringify(value)); }
    const value = await this.backend.read(this.scope, path); if (value) return Buffer.from(value); throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
  }
  override async readText(path: string) { try { return (await this.readFile(path)).toString("utf8"); } catch (error) { if (isMissing(error)) return ""; throw error; } }
  override async readJSON<T>(path: string, schema?: z.ZodType<T>): Promise<T | null> { const text = await this.readText(path); if (!text) return null; const value: unknown = JSON.parse(text); return schema ? schema.parse(value) : value as T; }
  override async writeFile(path: string, data: string | Uint8Array) {
    const text = Buffer.from(data).toString("utf8");
    if (path === "meta/checkpoints.jsonl") { await this.backend.replaceCheckpoints(this.scope, parseJSONLines(text, CheckpointSchema, true)); return; }
    if (path === "meta/usage.json") { await this.backend.saveUsage(this.scope, UsageStateSchema.parse(JSON.parse(text))); return; }
    await this.backend.write(this.scope, path, Buffer.from(data));
  }
  override async writeJSON(path: string, value: unknown) { await this.writeFile(path, JSON.stringify(value, null, 2)); }
  override async appendJSONLine(path: string, value: unknown) {
    if (path === "meta/checkpoints.jsonl") { await this.backend.appendCheckpoint(this.scope, CheckpointSchema.parse(value)); return; }
    await this.writeFile(path, `${await this.readText(path)}${JSON.stringify(value)}\n`);
  }
  override async remove(path: string) {
    if (path === "meta/runtime/queue.jsonl") { await this.backend.clearRuntime(this.scope); return; }
    if (path === "meta/checkpoints.jsonl") { await this.backend.replaceCheckpoints(this.scope, []); return; }
    await this.backend.remove(this.scope, path);
  }
  withBackend(backend: DatabaseBackend) { return new DatabaseFileIO(this.scope, backend); }
}

export class DatabaseRuntimeStore extends RuntimeStore {
  constructor(private readonly databaseIo: DatabaseFileIO) { super(databaseIo); }
  override appendQueue(item: RuntimeQueueItem) { return this.databaseIo.backend.appendRuntime(this.databaseIo.scope, RuntimeQueueItemSchema.parse({ ...item, time: item.time || new Date().toISOString() })); }
  override loadQueue() { return this.databaseIo.backend.loadRuntime(this.databaseIo.scope); }
  override async loadQueueAfter(seq: number) { return (await this.loadQueue()).filter((item) => item.seq > seq); }
}
