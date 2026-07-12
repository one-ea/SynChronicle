import { RuntimeQueueItemSchema, RuntimeTaskLogEntrySchema, type RuntimeQueueItem, type RuntimeTaskLogEntry } from "../domain/index.js";
import { FileIO, parseJSONLines } from "./io.js";

export class RuntimeStore {
  private nextSeq?: number;
  private chain = Promise.resolve();
  constructor(private readonly io: FileIO) {}
  appendQueue(item: RuntimeQueueItem) { const result = this.chain.then(async () => { if (this.nextSeq === undefined) this.nextSeq = (await this.loadQueue()).at(-1)?.seq ?? 0; const value = RuntimeQueueItemSchema.parse({ ...item, seq: ++this.nextSeq, time: item.time || new Date().toISOString() }); await this.io.appendJSONLine("meta/runtime/queue.jsonl", value); return value; }); this.chain = result.then(() => undefined, () => undefined); return result; }
  async loadQueue() { return parseJSONLines(await this.io.readText("meta/runtime/queue.jsonl"), RuntimeQueueItemSchema); }
  async loadQueueAfter(seq: number) { return (await this.loadQueue()).filter((item) => item.seq > seq); }
  async appendTaskLog(taskId: string, entry: RuntimeTaskLogEntry) { if (!taskId.trim()) return; const value = RuntimeTaskLogEntrySchema.parse({ ...entry, task_id: entry.task_id || taskId, time: entry.time || new Date().toISOString() }); await this.io.appendJSONLine(`meta/runtime/tasks/${taskId}.log`, value); }
  async loadTaskLog(taskId: string) { return taskId.trim() ? parseJSONLines(await this.io.readText(`meta/runtime/tasks/${taskId}.log`), RuntimeTaskLogEntrySchema) : []; }
  async reset() { await this.io.remove("meta/runtime/queue.jsonl"); await this.io.remove("meta/runtime/tasks"); await this.io.ensureDirs(["meta/runtime/tasks"]); this.nextSeq = 0; }
}
