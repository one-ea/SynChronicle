import { AsyncQueue } from "./asyncQueue.js";
export interface RuntimeStreamChunk { sequence: number; text: string }
export class RuntimeStream {
  private queue = new AsyncQueue<RuntimeStreamChunk>();
  iterable(): AsyncIterable<RuntimeStreamChunk> { return this.queue; }
  write(sequence: number, text: string): void { if (text) this.queue.push({ sequence, text }); }
  end(): void { this.queue.close(); }
}
