import { createHash } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { artifacts, chapters, checkpoints, projects, runEvents, tasks, usageRecords } from "../../db/schema/index.js";
import type { Checkpoint, RuntimeQueueItem, UsageState } from "../../domain/index.js";
import { appendRunEventInTransaction } from "../../realtime/append.js";

export interface LeaseFence { taskId: string; owner: string; version: number; }
export interface DatabaseStoreScope { userId: string; projectId: string; runId: string; taskFingerprint?: string; projectVersion?: number; lease?: LeaseFence; }
export type DomainTableName = "run_events" | "checkpoints" | "usage_records";

export interface DatabaseBackend {
  read(scope: DatabaseStoreScope, path: string): Promise<Uint8Array | null>;
  write(scope: DatabaseStoreScope, path: string, content: Uint8Array): Promise<void>;
  remove(scope: DatabaseStoreScope, path: string): Promise<void>;
  loadRuntime(scope: DatabaseStoreScope): Promise<RuntimeQueueItem[]>;
  appendRuntime(scope: DatabaseStoreScope, item: RuntimeQueueItem): Promise<RuntimeQueueItem>;
  clearRuntime(scope: DatabaseStoreScope): Promise<void>;
  loadCheckpoints(scope: DatabaseStoreScope): Promise<Checkpoint[]>;
  latestCheckpoint(scope: DatabaseStoreScope): Promise<{ taskFingerprint: string; projectVersion: number } | null>;
  appendCheckpoint(scope: DatabaseStoreScope, checkpoint: Checkpoint): Promise<void>;
  replaceCheckpoints(scope: DatabaseStoreScope, values: Checkpoint[]): Promise<void>;
  loadUsage(scope: DatabaseStoreScope): Promise<UsageState | null>;
  saveUsage(scope: DatabaseStoreScope, state: UsageState): Promise<void>;
  transaction<T>(scope: DatabaseStoreScope, operation: (backend: DatabaseBackend) => Promise<T>): Promise<T>;
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
    if (!this.transactionBound) return this.transaction(scope, (backend) => backend.write(scope, path, content));
    const text = Buffer.from(content).toString("utf8");
    const chapter = chapterSequence(path);
    if (chapter !== null) {
      const current = await this.database.select({ version: chapters.version }).from(chapters).where(chapterScope(scope, chapter)).orderBy(desc(chapters.version)).limit(1);
      const version = (current[0]?.version ?? 0) + 1;
      await this.database.insert(chapters).values({ ...ownership(scope), sequence: chapter, title: chapterTitle(text, chapter), body: text, status: "complete", version });
      return;
    }
    const json = parseJson(path, text);
    const current = await this.database.select({ version: artifacts.version }).from(artifacts).where(and(artifactScope(scope), eq(artifacts.type, path))).orderBy(desc(artifacts.version)).limit(1);
    const version = (current[0]?.version ?? 0) + 1;
    await this.database.insert(artifacts).values({ ...ownership(scope), type: path, contentText: json === undefined ? text : null, contentJson: json ?? null, status: "committed", version });
  }

  async remove(scope: DatabaseStoreScope, path: string): Promise<void> {
    if (!this.transactionBound) return this.transaction(scope, (backend) => backend.remove(scope, path));
    const chapter = chapterSequence(path);
    if (chapter !== null) await this.database.delete(chapters).where(chapterScope(scope, chapter));
    else await this.database.delete(artifacts).where(and(artifactScope(scope), eq(artifacts.type, path)));
  }

  async loadRuntime(scope: DatabaseStoreScope) {
    const rows = await this.database.select({ payload: runEvents.payload }).from(runEvents).where(and(runScope(runEvents, scope), sql`${runEvents.payload} ? 'kind'`)).orderBy(asc(runEvents.sequence));
    return rows.map((row) => row.payload as RuntimeQueueItem);
  }

  async appendRuntime(scope: DatabaseStoreScope, item: RuntimeQueueItem): Promise<RuntimeQueueItem> {
    if (!this.transactionBound) return this.transaction(scope, (backend) => backend.appendRuntime(scope, item));
    const time = item.time || new Date().toISOString();
    const event = await appendRunEventInTransaction(this.database, ownership(scope), {
      stableId: eventStableId(item),
      type: item.kind,
      payload: (sequence: number) => ({ ...item, seq: sequence, time }),
    });
    return { ...item, seq: event.sequence, time };
  }

  async clearRuntime(scope: DatabaseStoreScope) { if (!this.transactionBound) return this.transaction(scope, (backend) => backend.clearRuntime(scope)); await this.database.delete(runEvents).where(runScope(runEvents, scope)); }

  async loadCheckpoints(scope: DatabaseStoreScope) {
    const rows = await this.database.select({ state: checkpoints.state }).from(checkpoints).where(runScope(checkpoints, scope)).orderBy(asc(checkpoints.version));
    return rows.map((row) => row.state as Checkpoint);
  }

  async latestCheckpoint(scope: DatabaseStoreScope) {
    const rows = await this.database.select({ taskFingerprint: checkpoints.taskFingerprint, projectVersion: checkpoints.projectVersion }).from(checkpoints)
      .where(runScope(checkpoints, scope)).orderBy(desc(checkpoints.version)).limit(1);
    return rows[0] ?? null;
  }

  async appendCheckpoint(scope: DatabaseStoreScope, checkpoint: Checkpoint) {
    if (!this.transactionBound) return this.transaction(scope, (backend) => backend.appendCheckpoint(scope, checkpoint));
    await this.database.insert(checkpoints).values(checkpointRow(scope, checkpoint));
    await appendRunEventInTransaction(this.database, ownership(scope), { stableId: `checkpoint:${scope.runId}:${checkpoint.seq}`, type: "checkpoint.committed", payload: { version: checkpoint.seq, summary: checkpoint.step } });
  }

  async replaceCheckpoints(scope: DatabaseStoreScope, values: Checkpoint[]) {
    if (!this.transactionBound) return this.transaction(scope, (backend) => backend.replaceCheckpoints(scope, values));
    await this.database.delete(checkpoints).where(runScope(checkpoints, scope));
    if (values.length) await this.database.insert(checkpoints).values(values.map((value) => checkpointRow(scope, value)));
  }

  async loadUsage(scope: DatabaseStoreScope) {
    const rows = await this.database.select({ state: usageRecords.state }).from(usageRecords).where(and(runScope(usageRecords, scope), eq(usageRecords.agent, "__store_state__"))).orderBy(desc(usageRecords.createdAt)).limit(1);
    return (rows[0]?.state as UsageState | undefined) ?? null;
  }

  async saveUsage(scope: DatabaseStoreScope, state: UsageState) {
    if (!this.transactionBound) return this.transaction(scope, (backend) => backend.saveUsage(scope, state));
    const snapshotId = usageSnapshotId(state);
    await this.database.insert(usageRecords).values({ ...ownership(scope), snapshotId, agent: "__store_state__", credentialSource: "store", provider: "store", model: "aggregate", inputTokens: state.overall.input, outputTokens: state.overall.output, cost: String(state.overall.cost_usd), latencyMs: 0, state }).onConflictDoUpdate({ target: [usageRecords.runId, usageRecords.snapshotId], set: { state, inputTokens: state.overall.input, outputTokens: state.overall.output, cost: String(state.overall.cost_usd) } });
  }

  transaction<T>(scope: DatabaseStoreScope, operation: (backend: DatabaseBackend) => Promise<T>): Promise<T> {
    if (this.transactionBound) return operation(this);
    return this.database.transaction(async (transaction) => {
      if (scope.lease) {
        const [owned] = await transaction.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, scope.lease.taskId), eq(tasks.leaseOwner, scope.lease.owner), eq(tasks.leaseVersion, scope.lease.version), sql`${tasks.status} in ('leased', 'running')`, sql`${tasks.leaseExpiresAt} > now()`)).limit(1).for("update");
        if (!owned) throw new Error("lease ownership lost");
      }
      if (scope.projectVersion !== undefined) {
        const [project] = await transaction.select({ version: projects.version }).from(projects).where(and(eq(projects.id, scope.projectId), eq(projects.userId, scope.userId))).limit(1);
        if (!project || project.version !== scope.projectVersion) throw new Error("project version changed");
      }
      return operation(new DrizzleDatabaseBackend(transaction as unknown as Database, true));
    });
  }
}

export class MemoryDatabaseBackend implements DatabaseBackend {
  private values: Map<string, Uint8Array>;
  private tables: Record<DomainTableName, unknown[]>;
  private leases: Map<string, LeaseFence>;
  constructor(values = new Map<string, Uint8Array>(), tables: Record<DomainTableName, unknown[]> = { run_events: [], checkpoints: [], usage_records: [] }, leases = new Map<string, LeaseFence>()) { this.values = values; this.tables = tables; this.leases = leases; }
  setLease(lease: LeaseFence) { this.leases.set(lease.taskId, structuredClone(lease)); }
  inspect(table: DomainTableName) { return structuredClone(this.tables[table]); }
  async read(scope: DatabaseStoreScope, path: string) { const value = this.values.get(key(scope, path)); return value ? Buffer.from(value) : null; }
  async write(scope: DatabaseStoreScope, path: string, content: Uint8Array) { assertMemoryLease(this.leases, scope); if (path === "invalid/constraint.json" || chapterSequence(path) === 0) throw new Error("constraint failure"); this.values.set(key(scope, path), Buffer.from(content)); }
  async remove(scope: DatabaseStoreScope, path: string) { assertMemoryLease(this.leases, scope); this.values.delete(key(scope, path)); }
  async loadRuntime(scope: DatabaseStoreScope) { return this.runtimeRows(scope).map((row) => row.value); }
  async appendRuntime(scope: DatabaseStoreScope, item: RuntimeQueueItem): Promise<RuntimeQueueItem> { assertMemoryLease(this.leases, scope); const rows = this.runtimeRows(scope); const value = { ...item, seq: (rows.at(-1)?.value.seq ?? 0) + 1, time: item.time || new Date().toISOString() }; const stableId = eventStableId(value); if (!stableId || !rows.some((row) => eventStableId(row.value) === stableId)) this.tables.run_events.push({ ...scope, value }); return value; }
  async clearRuntime(scope: DatabaseStoreScope) { assertMemoryLease(this.leases, scope); this.tables.run_events = this.tables.run_events.filter((row) => !matches(row, scope)); }
  async loadCheckpoints(scope: DatabaseStoreScope) { return this.rows<Checkpoint>("checkpoints", scope).map((row) => row.value); }
  async latestCheckpoint(scope: DatabaseStoreScope) { const row = this.rows<Checkpoint>("checkpoints", scope).at(-1); return row ? { taskFingerprint: row.taskFingerprint ?? row.value.digest ?? "", projectVersion: row.projectVersion ?? 1 } : null; }
  async appendCheckpoint(scope: DatabaseStoreScope, value: Checkpoint) { assertMemoryLease(this.leases, scope); this.tables.checkpoints.push({ ...scope, value: structuredClone(value) }); const stableId = `checkpoint:${scope.runId}:${value.seq}`; if (!this.tables.run_events.some((row) => (row as { stableId?: string }).stableId === stableId)) this.tables.run_events.push({ ...scope, stableId, type: "checkpoint.committed", payload: { version: value.seq, summary: value.step } }); }
  async replaceCheckpoints(scope: DatabaseStoreScope, values: Checkpoint[]) { assertMemoryLease(this.leases, scope); this.tables.checkpoints = this.tables.checkpoints.filter((row) => !matches(row, scope)); for (const value of values) await this.appendCheckpoint(scope, value); }
  async loadUsage(scope: DatabaseStoreScope) { return this.rows<UsageState>("usage_records", scope).at(-1)?.value ?? null; }
  async saveUsage(scope: DatabaseStoreScope, value: UsageState) { assertMemoryLease(this.leases, scope); const snapshotId = usageSnapshotId(value); const existing = this.tables.usage_records.find((row) => matches(row, scope) && (row as { snapshotId?: string }).snapshotId === snapshotId) as { value: UsageState } | undefined; if (existing) existing.value = structuredClone(value); else this.tables.usage_records.push({ ...scope, snapshotId, value: structuredClone(value) }); }
  async transaction<T>(scope: DatabaseStoreScope, operation: (backend: DatabaseBackend) => Promise<T>): Promise<T> { assertMemoryLease(this.leases, scope); const staged = new MemoryDatabaseBackend(cloneValues(this.values), structuredClone(this.tables), new Map(this.leases)); const result = await operation(staged); this.values = staged.values; this.tables = staged.tables; return result; }
  private rows<T>(table: DomainTableName, scope: DatabaseStoreScope) { return this.tables[table].filter((row) => matches(row, scope)) as Array<DatabaseStoreScope & { value: T }>; }
  private runtimeRows(scope: DatabaseStoreScope) { return this.tables.run_events.filter((row) => matches(row, scope) && "value" in (row as object)) as Array<DatabaseStoreScope & { value: RuntimeQueueItem }>; }
}

export function scopedArtifactFilter(scope: DatabaseStoreScope) { return artifactScope(scope); }
function artifactScope(scope: DatabaseStoreScope) { return and(eq(artifacts.userId, scope.userId), eq(artifacts.projectId, scope.projectId), eq(artifacts.runId, scope.runId)); }
function chapterScope(scope: DatabaseStoreScope, sequence: number) { return and(eq(chapters.userId, scope.userId), eq(chapters.projectId, scope.projectId), eq(chapters.runId, scope.runId), eq(chapters.sequence, sequence)); }
function runScope(table: typeof runEvents | typeof checkpoints | typeof usageRecords, scope: DatabaseStoreScope) { return and(eq(table.userId, scope.userId), eq(table.projectId, scope.projectId), eq(table.runId, scope.runId)); }
function checkpointRow(scope: DatabaseStoreScope, checkpoint: Checkpoint) { return { ...ownership(scope), version: checkpoint.seq, state: checkpoint, summary: checkpoint.step, taskFingerprint: scope.taskFingerprint ?? checkpoint.digest ?? `${checkpoint.scope.kind}:${checkpoint.step}:${checkpoint.seq}`, projectVersion: scope.projectVersion ?? 1 }; }
function key(scope: DatabaseStoreScope, path: string) { return `${scope.userId}\0${scope.projectId}\0${scope.runId}\0${path}`; }
function matches(row: unknown, scope: DatabaseStoreScope) { const value = row as Partial<DatabaseStoreScope>; return value.userId === scope.userId && value.projectId === scope.projectId && value.runId === scope.runId; }
function cloneValues(values: Map<string, Uint8Array>) { return new Map([...values].map(([path, content]) => [path, Buffer.from(content)])); }
function chapterSequence(path: string) { const match = /^chapters\/(\d+)\.md$/.exec(path); return match?.[1] ? Number(match[1]) : null; }
function chapterTitle(text: string, chapter: number) { return text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? `Chapter ${chapter}`; }
function parseJson(path: string, text: string): unknown | undefined { if (!path.endsWith(".json")) return undefined; return JSON.parse(text); }
function ownership(scope: DatabaseStoreScope) { return { userId: scope.userId, projectId: scope.projectId, runId: scope.runId }; }
function assertMemoryLease(leases: Map<string, LeaseFence>, scope: DatabaseStoreScope) { if (!scope.lease) return; const current = leases.get(scope.lease.taskId); if (!current || current.owner !== scope.lease.owner || current.version !== scope.lease.version) throw new Error("lease ownership lost"); }
function eventStableId(item: RuntimeQueueItem): string | null { const payload = item.payload as { id?: unknown } | undefined; return typeof payload?.id === "string" && payload.id ? payload.id : null; }
function usageSnapshotId(state: UsageState): string { return createHash("sha256").update(JSON.stringify({ overall: state.overall, per_agent: state.per_agent, missing_assistant_usage: state.missing_assistant_usage })).digest("hex"); }
