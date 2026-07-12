export class AsyncQueue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private waiters: Array<(result: IteratorResult<T>) => void> = [];
  private ended = false;
  push(value: T): void { if (this.ended) return; const waiter = this.waiters.shift(); if (waiter) waiter({ value, done: false }); else this.values.push(value); }
  close(): void { this.ended = true; for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true }); }
  [Symbol.asyncIterator](): AsyncIterator<T> { return { next: async () => { const value = this.values.shift(); if (value !== undefined) return { value, done: false }; if (this.ended) return { value: undefined, done: true }; return new Promise((resolve) => this.waiters.push(resolve)); } }; }
}
