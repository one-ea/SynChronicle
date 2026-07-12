import { AsyncQueue } from "./asyncQueue.js";
export class RuntimeStream {
  private queue = new AsyncQueue<string>();
  iterable(): AsyncIterable<string> { return this.queue; }
  write(delta: string): void { if (delta) this.queue.push(delta); }
  end(): void { this.queue.close(); }
}
