/**
 * 运行时事件枢纽：纯逻辑（可在 Node 测试），Durable Object 内使用。
 * 有界回放缓冲 + 订阅扇出；快照单独存储。
 */

export interface HubEvent { event: string; data: unknown }

export class EventHub {
  private readonly backlog: HubEvent[] = [];
  private readonly listeners = new Set<(event: HubEvent) => void>();
  private snapshot: unknown = null;

  constructor(private readonly capacity = 300) {}

  publish(event: string, data: unknown): void {
    if (event === "snapshot") { this.snapshot = data; return; }
    const item: HubEvent = { event, data };
    this.backlog.push(item);
    if (this.backlog.length > this.capacity) this.backlog.splice(0, this.backlog.length - this.capacity);
    for (const listener of this.listeners) listener(item);
  }

  subscribe(listener: (event: HubEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  replay(): HubEvent[] { return [...this.backlog]; }
  currentSnapshot(): unknown { return this.snapshot; }
  subscriberCount(): number { return this.listeners.size; }
}
