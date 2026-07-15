import type { Database } from "../../db/client.js";
import { Store, StoreScope } from "../index.js";
import type { StagingSession } from "../staging.js";
import type { Progress, RunMeta } from "../../domain/index.js";
import type { DurableSteerCommand } from "../port.js";
import { DrizzleDatabaseBackend, MemoryDatabaseBackend, scopedArtifactFilter, type DatabaseBackend, type DatabaseStoreScope } from "./artifacts.js";
import { commitDatabaseStaging, DatabaseRecordingTransaction } from "./checkpoints.js";
import { DatabaseFileIO, DatabaseRuntimeStore } from "./runtime.js";

export class DatabaseStore extends Store {
  override readonly runtime: DatabaseRuntimeStore;
  private readonly databaseIo: DatabaseFileIO;
  constructor(database: Database, readonly scope: DatabaseStoreScope, readonly backend: DatabaseBackend = new DrizzleDatabaseBackend(database)) {
    const io = new DatabaseFileIO(scope, backend);
    super(io.dir, io);
    this.databaseIo = io;
    this.runtime = new DatabaseRuntimeStore(io);
  }
  static artifactScope(scope: DatabaseStoreScope) { return scopedArtifactFilter(scope); }
  latestCheckpoint() { return this.backend.latestCheckpoint(this.scope); }
  async applySteerCommand(commandId: string, instruction: string, fallback: RunMeta): Promise<boolean> {
    return this.backend.transaction(this.scope, async (backend) => {
      const io = this.databaseIo.withBackend(backend);
      const commands = await io.readJSON<DurableSteerCommand[]>("meta/worker-steer/inbox.json") ?? [];
      if (commands.some(({ id }) => id === commandId)) return false;
      const next = [...commands, { id: commandId, instruction }];
      const current = await io.readJSON<RunMeta>("meta/run.json") ?? fallback;
      await io.writeJSON("meta/worker-steer/inbox.json", next);
      await io.writeJSON("meta/run.json", { ...current, pending_steer: steerText(next), steer_history: [...current.steer_history, { input: instruction, timestamp: new Date().toISOString() }] });
      return true;
    });
  }
  async pendingSteerCommands(): Promise<DurableSteerCommand[]> { return await this.databaseIo.readJSON<DurableSteerCommand[]>("meta/worker-steer/inbox.json") ?? []; }
  async completeSteerDelivery(commandIds: string[]): Promise<void> {
    await this.backend.transaction(this.scope, async (backend) => {
      const io = this.databaseIo.withBackend(backend);
      const ids = new Set(commandIds);
      const remaining = (await io.readJSON<DurableSteerCommand[]>("meta/worker-steer/inbox.json") ?? []).filter(({ id }) => !ids.has(id));
      await io.writeJSON("meta/worker-steer/inbox.json", remaining);
      const meta = await io.readJSON<RunMeta>("meta/run.json");
      if (meta) await io.writeJSON("meta/run.json", { ...meta, pending_steer: steerText(remaining) });
      const progress = await io.readJSON<Progress>("meta/progress.json");
      if (progress?.flow === "steering" && !remaining.length) await io.writeJSON("meta/progress.json", { ...progress, flow: "writing" });
    });
  }
  override resolveExportPath(_filename: string): string { throw new Error("DatabaseStore requires an explicit export path"); }
  override recordingTransaction() { return new DatabaseRecordingTransaction(this.databaseIo); }
  override async commitStaged(staging: StagingSession, candidateIds: string[]) { await commitDatabaseStaging(this.databaseIo, staging, candidateIds); await this.checkpoints.reload(); }
}

export type MemoryDatabaseStore = DatabaseStore & { backend: MemoryDatabaseBackend };
export function createMemoryDatabaseStore(scope: DatabaseStoreScope, backend = new MemoryDatabaseBackend()): MemoryDatabaseStore {
  return new DatabaseStore({} as Database, scope, backend) as MemoryDatabaseStore;
}

export { DatabaseRecordingTransaction, DatabaseFileIO, DrizzleDatabaseBackend, MemoryDatabaseBackend, StoreScope };
export type { DatabaseBackend, DatabaseStoreScope };

function steerText(commands: DurableSteerCommand[]): string { return commands.map(({ instruction }) => instruction).join("\n"); }
