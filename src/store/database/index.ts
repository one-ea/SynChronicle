import type { Database } from "../../db/client.js";
import { Store, StoreScope } from "../index.js";
import type { StagingSession } from "../staging.js";
import type { RunMeta } from "../../domain/index.js";
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
      const marker = `meta/worker-steer/${commandId}.json`;
      if (await backend.read(this.scope, marker)) return false;
      const current = await io.readJSON<RunMeta>("meta/run.json") ?? fallback;
      await io.writeJSON("meta/run.json", { ...current, pending_steer: [current.pending_steer, instruction].filter(Boolean).join("\n"), steer_history: [...current.steer_history, { input: instruction, timestamp: new Date().toISOString() }] });
      await backend.write(this.scope, marker, Buffer.from(JSON.stringify({ commandId, instruction })));
      return true;
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
