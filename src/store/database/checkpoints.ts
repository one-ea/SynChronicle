import type { StagingSession } from "../staging.js";
import { RecordingTransaction, Store } from "../index.js";
import { RecordingFileIO } from "../io.js";
import { DatabaseFileIO } from "./runtime.js";

export class DatabaseRecordingTransaction extends RecordingTransaction {
  constructor(io: DatabaseFileIO) { super(io.dir, io); }
}

export async function commitDatabaseStaging(io: DatabaseFileIO, staging: StagingSession, candidateIds: string[]): Promise<void> {
  await io.backend.transaction(io.scope, async (backend) => {
    const transactionIo = io.withBackend(backend);
    const transactionStaging = staging.bind(transactionIo);
    const state = await transactionStaging.loadState<{ completion?: unknown }>();
    await transactionStaging.commit(candidateIds);
    await backend.appendRuntime(io.scope, { seq: 0, time: new Date().toISOString(), kind: "ui_event", priority: "control", category: "REFLECTION.COMPLETED", summary: "候选提交完成", payload: state?.completion ?? { type: "reflection.completed", candidateIds } });
  });
}

export function createRecordingStore(io: DatabaseFileIO) { return new Store(io.dir, new RecordingFileIO(io)); }
