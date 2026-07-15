import type { Database } from "../../db/client.js";
import { Store, StoreScope } from "../index.js";
import type { StagingSession } from "../staging.js";
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
