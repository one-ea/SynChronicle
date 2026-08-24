import { AsyncQueue } from "./asyncQueue.js";

/** Internal marker separating generation runs on the shared stream. */
export const RUN_END = "\u0000run_end";

export class RuntimeStream {
  private readonly queue = new AsyncQueue<string>();
  private closed = false;

  iterable(includeBoundaries = false): AsyncIterable<string> {
    const queue = this.queue;
    return (async function* () {
      for await (const value of queue) {
        if (value === RUN_END) {
          if (includeBoundaries) yield value;
          else return;
        } else {
          yield value;
        }
      }
    })();
  }
  write(delta: string): void { if (!this.closed && delta) this.queue.push(delta); }
  end(): void { if (!this.closed) this.queue.push(RUN_END); }
  close(): void { if (!this.closed) { this.closed = true; this.queue.close(); } }
}
