import type { StagingSession } from "../staging.js";
import { RecordingTransaction, Store } from "../index.js";
import { RecordingFileIO } from "../io.js";
import { DatabaseFileIO } from "./runtime.js";

export class DatabaseRecordingTransaction extends RecordingTransaction {
  constructor(io: DatabaseFileIO) { super(io.dir, io); }
}

export async function commitDatabaseStaging(io: DatabaseFileIO, staging: StagingSession, candidateIds: string[]): Promise<void> {
  await io.backend.transaction(async (backend) => {
    const transactionIo = io.withBackend(backend);
    const original = Reflect.get(staging, "io") as DatabaseFileIO;
    Reflect.set(staging, "io", transactionIo);
    try {
      const state = await staging.loadState<{ completion?: unknown }>();
      await staging.commit(candidateIds);
      const store = new Store(transactionIo.dir, transactionIo);
      await store.runtime.appendQueue({ seq: 0, time: new Date().toISOString(), kind: "ui_event", priority: "control", category: "REFLECTION.COMPLETED", summary: "候选提交完成", payload: state?.completion ?? { type: "reflection.completed", candidateIds } });
    } finally {
      Reflect.set(staging, "io", original);
    }
  });
}

export function createRecordingStore(io: DatabaseFileIO) { return new Store(io.dir, new RecordingFileIO(io)); }
