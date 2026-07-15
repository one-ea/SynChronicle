import { AsyncQueue } from "./asyncQueue.js";
export interface RuntimeStreamChunk { sequence: number; text: string; eventSequence?: number }
export class RuntimeStream {
  private queue = new AsyncQueue<RuntimeStreamChunk>();
  iterable(): AsyncIterable<RuntimeStreamChunk> { return this.queue; }
  write(sequence: number, text: string, eventSequence?: number): void { if (text) this.queue.push({ sequence, text, ...(eventSequence === undefined ? {} : { eventSequence }) }); }
  end(): void { this.queue.close(); }
}
