import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { artifacts, chapters, checkpoints, runEvents, usageRecords } from "../../db/schema/index.js";
import type { Checkpoint, RuntimeQueueItem, UsageState } from "../../domain/index.js";

export interface DatabaseStoreScope { userId: string; projectId: string; runId: string; taskFingerprint?: string; }
export type DomainTableName = "run_events" | "checkpoints" | "usage_records";

export interface DatabaseBackend {
  read(scope: DatabaseStoreScope, path: string): Promise<Uint8Array | null>;
  write(scope: DatabaseStoreScope, path: string, content: Uint8Array): Promise<void>;
  remove(scope: DatabaseStoreScope, path: string): Promise<void>;
  loadRuntime(scope: DatabaseStoreScope): Promise<RuntimeQueueItem[]>;
  appendRuntime(scope: DatabaseStoreScope, item: RuntimeQueueItem): Promise<RuntimeQueueItem>;
  clearRuntime(scope: DatabaseStoreScope): Promise<void>;
  loadCheckpoints(scope: DatabaseStoreScope): Promise<Checkpoint[]>;
  latestCheckpointFingerprint(scope: DatabaseStoreScope): Promise<string | null>;
  appendCheckpoint(scope: DatabaseStoreScope, checkpoint: Checkpoint): Promise<void>;
  replaceCheckpoints(scope: DatabaseStoreScope, values: Checkpoint[]): Promise<void>;
  loadUsage(scope: DatabaseStoreScope): Promise<UsageState | null>;
  saveUsage(scope: DatabaseStoreScope, state: UsageState): Promise<void>;
  transaction<T>(operation: (backend: DatabaseBackend) => Promise<T>): Promise<T>;
}

export class DrizzleDatabaseBackend implements DatabaseBackend {
  constructor(private readonly database: Database, private readonly transactionBound = false) {}

  async read(scope: DatabaseStoreScope, path: string): Promise<Uint8Array | null> {
    const chapter = chapterSequence(path);
    if (chapter !== null) {
      const rows = await this.database.select({ body: chapters.body }).from(chapters).where(chapterScope(scope, chapter)).orderBy(desc(chapters.version)).limit(1);
      return rows[0] ? Buffer.from(rows[0].body) : null;
    }
    const rows = await this.database.select({ text: artifacts.contentText, json: artifacts.contentJson }).from(artifacts).where(and(artifactScope(scope), eq(artifacts.type, path))).orderBy(desc(artifacts.version)).limit(1);
    const row = rows[0];
    return row ? Buffer.from(row.text ?? JSON.stringify(row.json)) : null;
  }

  async write(scope: DatabaseStoreScope, path: string, content: Uint8Array): Promise<void> {
    const text = Buffer.from(content).toString("utf8");
    const chapter = chapterSequence(path);
    if (chapter !== null) {
      const current = await this.database.select({ version: chapters.version }).from(chapters).where(chapterScope(scope, chapter)).orderBy(desc(chapters.version)).limit(1);
      const version = (current[0]?.version ?? 0) + 1;
      await this.database.insert(chapters).values({ ...scope, sequence: chapter, title: chapterTitle(text, chapter), body: text, status: "complete", version });
      return;
    }
    const json = parseJson(path, text);
    const current = await this.database.select({ version: artifacts.version }).from(artifacts).where(and(artifactScope(scope), eq(artifacts.type, path))).orderBy(desc(artifacts.version)).limit(1);
    const version = (current[0]?.version ?? 0) + 1;
    await this.database.insert(artifacts).values({ ...scope, type: path, contentText: json === undefined ? text : null, contentJson: json ?? null, status: "committed", version });
  }

  async remove(scope: DatabaseStoreScope, path: string): Promise<void> {
    const chapter = chapterSequence(path);
    if (chapter !== null) await this.database.delete(chapters).where(chapterScope(scope, chapter));
    else await this.database.delete(artifacts).where(and(artifactScope(scope), eq(artifacts.type, path)));
  }

  async loadRuntime(scope: DatabaseStoreScope) {
    const rows = await this.database.select({ payload: runEvents.payload }).from(runEvents).where(runScope(runEvents, scope)).orderBy(asc(runEvents.sequence));
    return rows.map((row) => row.payload as RuntimeQueueItem);
  }

  async appendRuntime(scope: DatabaseStoreScope, item: RuntimeQueueItem): Promise<RuntimeQueueItem> {
    if (!this.transactionBound) return this.transaction((backend) => backend.appendRuntime(scope, item));
    await this.database.execute(sql`select pg_advisory_xact_lock(hashtext(${scope.runId}))`);
    const rows = await this.database.select({ sequence: sql<number>`coalesce(max(${runEvents.sequence}), 0)` }).from(runEvents).where(runScope(runEvents, scope));
    const value = { ...item, seq: Number(rows[0]?.sequence ?? 0) + 1, time: item.time || new Date().toISOString() };
    await this.database.insert(runEvents).values({ ...scope, sequence: value.seq, type: value.kind, payload: value });
    return value;
  }

  async clearRuntime(scope: DatabaseStoreScope) { await this.database.delete(runEvents).where(runScope(runEvents, scope)); }

  async loadCheckpoints(scope: DatabaseStoreScope) {
    const rows = await this.database.select({ state: checkpoints.state }).from(checkpoints).where(runScope(checkpoints, scope)).orderBy(asc(checkpoints.version));
    return rows.map((row) => row.state as Checkpoint);
  }

  async latestCheckpointFingerprint(scope: DatabaseStoreScope) {
    const rows = await this.database.select({ fingerprint: checkpoints.taskFingerprint }).from(checkpoints)
      .where(runScope(checkpoints, scope)).orderBy(desc(checkpoints.version)).limit(1);
    return rows[0]?.fingerprint ?? null;
  }

  async appendCheckpoint(scope: DatabaseStoreScope, checkpoint: Checkpoint) {
    await this.database.insert(checkpoints).values(checkpointRow(scope, checkpoint));
  }

  async replaceCheckpoints(scope: DatabaseStoreScope, values: Checkpoint[]) {
    await this.database.delete(checkpoints).where(runScope(checkpoints, scope));
    if (values.length) await this.database.insert(checkpoints).values(values.map((value) => checkpointRow(scope, value)));
  }

  async loadUsage(scope: DatabaseStoreScope) {
    const rows = await this.database.select({ state: usageRecords.state }).from(usageRecords).where(and(runScope(usageRecords, scope), eq(usageRecords.agent, "__store_state__"))).orderBy(desc(usageRecords.createdAt)).limit(1);
    return (rows[0]?.state as UsageState | undefined) ?? null;
  }

  async saveUsage(scope: DatabaseStoreScope, state: UsageState) {
    if (JSON.stringify(await this.loadUsage(scope)) === JSON.stringify(state)) return;
    await this.database.insert(usageRecords).values({ ...scope, agent: "__store_state__", credentialSource: "store", provider: "store", model: "aggregate", inputTokens: state.overall.input, outputTokens: state.overall.output, cost: String(state.overall.cost_usd), latencyMs: 0, state });
  }

  transaction<T>(operation: (backend: DatabaseBackend) => Promise<T>): Promise<T> {
    if (this.transactionBound) return operation(this);
    return this.database.transaction((transaction) => operation(new DrizzleDatabaseBackend(transaction as unknown as Database, true)));
  }
}

export class MemoryDatabaseBackend implements DatabaseBackend {
  private values: Map<string, Uint8Array>;
  private tables: Record<DomainTableName, unknown[]>;
  constructor(values = new Map<string, Uint8Array>(), tables: Record<DomainTableName, unknown[]> = { run_events: [], checkpoints: [], usage_records: [] }) { this.values = values; this.tables = tables; }
  inspect(table: DomainTableName) { return structuredClone(this.tables[table]); }
  async read(scope: DatabaseStoreScope, path: string) { const value = this.values.get(key(scope, path)); return value ? Buffer.from(value) : null; }
  async write(scope: DatabaseStoreScope, path: string, content: Uint8Array) { if (path === "invalid/constraint.json" || chapterSequence(path) === 0) throw new Error("constraint failure"); this.values.set(key(scope, path), Buffer.from(content)); }
  async remove(scope: DatabaseStoreScope, path: string) { this.values.delete(key(scope, path)); }
  async loadRuntime(scope: DatabaseStoreScope) { return this.rows<RuntimeQueueItem>("run_events", scope).map((row) => row.value); }
  async appendRuntime(scope: DatabaseStoreScope, item: RuntimeQueueItem) { const rows = this.rows<RuntimeQueueItem>("run_events", scope); const value = { ...item, seq: (rows.at(-1)?.value.seq ?? 0) + 1, time: item.time || new Date().toISOString() }; this.tables.run_events.push({ ...scope, value }); return value; }
  async clearRuntime(scope: DatabaseStoreScope) { this.tables.run_events = this.tables.run_events.filter((row) => !matches(row, scope)); }
  async loadCheckpoints(scope: DatabaseStoreScope) { return this.rows<Checkpoint>("checkpoints", scope).map((row) => row.value); }
  async latestCheckpointFingerprint(scope: DatabaseStoreScope) { const row = this.rows<Checkpoint>("checkpoints", scope).at(-1); return row?.taskFingerprint ?? row?.value.digest ?? null; }
  async appendCheckpoint(scope: DatabaseStoreScope, value: Checkpoint) { this.tables.checkpoints.push({ ...scope, value: structuredClone(value) }); }
  async replaceCheckpoints(scope: DatabaseStoreScope, values: Checkpoint[]) { this.tables.checkpoints = this.tables.checkpoints.filter((row) => !matches(row, scope)); for (const value of values) await this.appendCheckpoint(scope, value); }
  async loadUsage(scope: DatabaseStoreScope) { return this.rows<UsageState>("usage_records", scope).at(-1)?.value ?? null; }
  async saveUsage(scope: DatabaseStoreScope, value: UsageState) { if (JSON.stringify(await this.loadUsage(scope)) !== JSON.stringify(value)) this.tables.usage_records.push({ ...scope, value: structuredClone(value) }); }
  async transaction<T>(operation: (backend: DatabaseBackend) => Promise<T>): Promise<T> { const staged = new MemoryDatabaseBackend(cloneValues(this.values), structuredClone(this.tables)); const result = await operation(staged); this.values = staged.values; this.tables = staged.tables; return result; }
  private rows<T>(table: DomainTableName, scope: DatabaseStoreScope) { return this.tables[table].filter((row) => matches(row, scope)) as Array<DatabaseStoreScope & { value: T }>; }
}

export function scopedArtifactFilter(scope: DatabaseStoreScope) { return artifactScope(scope); }
function artifactScope(scope: DatabaseStoreScope) { return and(eq(artifacts.userId, scope.userId), eq(artifacts.projectId, scope.projectId), eq(artifacts.runId, scope.runId)); }
function chapterScope(scope: DatabaseStoreScope, sequence: number) { return and(eq(chapters.userId, scope.userId), eq(chapters.projectId, scope.projectId), eq(chapters.runId, scope.runId), eq(chapters.sequence, sequence)); }
function runScope(table: typeof runEvents | typeof checkpoints | typeof usageRecords, scope: DatabaseStoreScope) { return and(eq(table.userId, scope.userId), eq(table.projectId, scope.projectId), eq(table.runId, scope.runId)); }
function checkpointRow(scope: DatabaseStoreScope, checkpoint: Checkpoint) { return { ...scope, version: checkpoint.seq, state: checkpoint, summary: checkpoint.step, taskFingerprint: scope.taskFingerprint ?? checkpoint.digest ?? `${checkpoint.scope.kind}:${checkpoint.step}:${checkpoint.seq}`, projectVersion: 1 }; }
function key(scope: DatabaseStoreScope, path: string) { return `${scope.userId}\0${scope.projectId}\0${scope.runId}\0${path}`; }
function matches(row: unknown, scope: DatabaseStoreScope) { const value = row as Partial<DatabaseStoreScope>; return value.userId === scope.userId && value.projectId === scope.projectId && value.runId === scope.runId; }
function cloneValues(values: Map<string, Uint8Array>) { return new Map([...values].map(([path, content]) => [path, Buffer.from(content)])); }
function chapterSequence(path: string) { const match = /^chapters\/(\d+)\.md$/.exec(path); return match?.[1] ? Number(match[1]) : null; }
function chapterTitle(text: string, chapter: number) { return text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? `Chapter ${chapter}`; }
function parseJson(path: string, text: string): unknown | undefined { if (!path.endsWith(".json")) return undefined; return JSON.parse(text); }
