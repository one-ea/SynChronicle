import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { artifacts } from "../../db/schema/index.js";
import { Store, StoreScope } from "../index.js";
import type { StagingSession } from "../staging.js";
import { DrizzleDatabaseBackend, MemoryDatabaseBackend, type DatabaseBackend, type DatabaseStoreScope } from "./artifacts.js";
import { commitDatabaseStaging, DatabaseRecordingTransaction } from "./checkpoints.js";
import { DatabaseFileIO } from "./runtime.js";

export class DatabaseStore extends Store {
  private readonly databaseIo: DatabaseFileIO;
  constructor(database: Database, readonly scope: DatabaseStoreScope, readonly backend: DatabaseBackend = new DrizzleDatabaseBackend(database)) {
    const io = new DatabaseFileIO(scope, backend);
    super(io.dir, io);
    this.databaseIo = io;
  }
  static artifactScope(scope: DatabaseStoreScope) { return and(eq(artifacts.userId, scope.userId), eq(artifacts.projectId, scope.projectId)); }
  override recordingTransaction() { return new DatabaseRecordingTransaction(this.databaseIo); }
  override async commitStaged(staging: StagingSession, candidateIds: string[]) { await commitDatabaseStaging(this.databaseIo, staging, candidateIds); await this.checkpoints.reload(); }
}

export type MemoryDatabaseStore = DatabaseStore & { backend: MemoryDatabaseBackend };
export function createMemoryDatabaseStore(scope: DatabaseStoreScope, backend = new MemoryDatabaseBackend()): MemoryDatabaseStore {
  return new DatabaseStore({} as Database, scope, backend) as MemoryDatabaseStore;
}

export { DatabaseRecordingTransaction, DatabaseFileIO, DrizzleDatabaseBackend, MemoryDatabaseBackend, StoreScope };
export type { DatabaseBackend, DatabaseStoreScope };
