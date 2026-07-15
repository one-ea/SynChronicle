import { and, asc, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { artifacts, chapters } from "../../db/schema/index.js";

export interface DatabaseStoreScope { userId: string; projectId: string; runId: string; }

export interface DatabaseBackend {
  read(scope: DatabaseStoreScope, path: string): Promise<Uint8Array | null>;
  write(scope: DatabaseStoreScope, path: string, content: Uint8Array): Promise<void>;
  remove(scope: DatabaseStoreScope, path: string): Promise<void>;
  transaction<T>(operation: (backend: DatabaseBackend) => Promise<T>): Promise<T>;
}

export class DrizzleDatabaseBackend implements DatabaseBackend {
  constructor(private readonly database: Database) {}

  async read(scope: DatabaseStoreScope, path: string): Promise<Uint8Array | null> {
    const chapter = chapterSequence(path);
    if (chapter !== null) {
      const rows = await this.database.select({ body: chapters.body }).from(chapters).where(and(eq(chapters.userId, scope.userId), eq(chapters.projectId, scope.projectId), eq(chapters.sequence, chapter))).orderBy(asc(chapters.version)).limit(1);
      return rows[0] ? Buffer.from(rows[0].body) : null;
    }
    const rows = await this.database.select({ text: artifacts.contentText, json: artifacts.contentJson }).from(artifacts).where(and(eq(artifacts.userId, scope.userId), eq(artifacts.projectId, scope.projectId), eq(artifacts.type, path), eq(artifacts.version, 1))).limit(1);
    const row = rows[0];
    if (!row) return null;
    return Buffer.from(row.text ?? JSON.stringify(row.json));
  }

  async write(scope: DatabaseStoreScope, path: string, content: Uint8Array): Promise<void> {
    const text = Buffer.from(content).toString("utf8");
    const chapter = chapterSequence(path);
    if (chapter !== null) {
      await this.database.insert(chapters).values({ userId: scope.userId, projectId: scope.projectId, sequence: chapter, title: chapterTitle(text, chapter), body: text, status: "complete", version: 1 }).onConflictDoUpdate({ target: [chapters.projectId, chapters.sequence], set: { body: text, title: chapterTitle(text, chapter), status: "complete", updatedAt: new Date() } });
      return;
    }
    const json = parseJson(path, text);
    await this.database.insert(artifacts).values({ userId: scope.userId, projectId: scope.projectId, type: path, contentText: json === undefined ? text : null, contentJson: json ?? null, status: "committed", version: 1 }).onConflictDoUpdate({ target: [artifacts.projectId, artifacts.type, artifacts.version], set: { contentText: json === undefined ? text : null, contentJson: json ?? null, status: "committed", updatedAt: new Date() } });
  }

  async remove(scope: DatabaseStoreScope, path: string): Promise<void> {
    const chapter = chapterSequence(path);
    if (chapter !== null) await this.database.delete(chapters).where(and(eq(chapters.userId, scope.userId), eq(chapters.projectId, scope.projectId), eq(chapters.sequence, chapter)));
    else await this.database.delete(artifacts).where(and(eq(artifacts.userId, scope.userId), eq(artifacts.projectId, scope.projectId), eq(artifacts.type, path)));
  }

  transaction<T>(operation: (backend: DatabaseBackend) => Promise<T>): Promise<T> {
    return this.database.transaction((transaction) => operation(new DrizzleDatabaseBackend(transaction as unknown as Database)));
  }
}

export class MemoryDatabaseBackend implements DatabaseBackend {
  private values: Map<string, Uint8Array>;
  constructor(values = new Map<string, Uint8Array>()) { this.values = values; }
  async read(scope: DatabaseStoreScope, path: string) { const value = this.values.get(key(scope, path)); return value ? Buffer.from(value) : null; }
  async write(scope: DatabaseStoreScope, path: string, content: Uint8Array) {
    if (path === "invalid/constraint.json") throw new Error("constraint failure");
    this.values.set(key(scope, path), Buffer.from(content));
  }
  async remove(scope: DatabaseStoreScope, path: string) { this.values.delete(key(scope, path)); }
  async transaction<T>(operation: (backend: DatabaseBackend) => Promise<T>): Promise<T> {
    const staged = new MemoryDatabaseBackend(new Map([...this.values].map(([path, content]) => [path, Buffer.from(content)])));
    const result = await operation(staged);
    this.values = staged.values;
    return result;
  }
}

function key(scope: DatabaseStoreScope, path: string) { return `${scope.userId}\0${scope.projectId}\0${scope.runId}\0${path}`; }
function chapterSequence(path: string) { const match = /^chapters\/(\d+)\.md$/.exec(path); return match?.[1] ? Number(match[1]) : null; }
function chapterTitle(text: string, chapter: number) { return text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? `Chapter ${chapter}`; }
function parseJson(path: string, text: string): unknown | undefined { if (!path.endsWith(".json")) return undefined; return JSON.parse(text); }
