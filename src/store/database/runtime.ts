import { z } from "zod";
import { FileIO, isMissing } from "../io.js";
import type { DatabaseBackend, DatabaseStoreScope } from "./artifacts.js";

export class DatabaseFileIO extends FileIO {
  override readonly usesFilesystemPaths = false;
  constructor(readonly scope: DatabaseStoreScope, readonly backend: DatabaseBackend) { super(`database://${scope.userId}/${scope.projectId}/${scope.runId}`); }
  override async ensureDirs(_dirs: string[]) {}
  override async lockKey() { return this.dir; }
  override async readFile(path: string) { const value = await this.backend.read(this.scope, path); if (value) return Buffer.from(value); throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" }); }
  override async readText(path: string) { try { return (await this.readFile(path)).toString("utf8"); } catch (error) { if (isMissing(error)) return ""; throw error; } }
  override async readJSON<T>(path: string, schema?: z.ZodType<T>): Promise<T | null> { const text = await this.readText(path); if (!text) return null; const value: unknown = JSON.parse(text); return schema ? schema.parse(value) : value as T; }
  override async writeFile(path: string, data: string | Uint8Array) { await this.backend.write(this.scope, path, Buffer.from(data)); }
  override async writeJSON(path: string, value: unknown) { await this.writeFile(path, JSON.stringify(value, null, 2)); }
  override async appendJSONLine(path: string, value: unknown) { await this.writeFile(path, `${await this.readText(path)}${JSON.stringify(value)}\n`); }
  override async remove(path: string) { await this.backend.remove(this.scope, path); }
  withBackend(backend: DatabaseBackend) { return new DatabaseFileIO(this.scope, backend); }
}
