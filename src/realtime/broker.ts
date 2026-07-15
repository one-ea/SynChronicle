import type { Database } from "../db/client.js";

export interface EventWakeup {
  runId?: string;
  sequence: number;
}

export type EventWakeupListener = (wakeup: EventWakeup) => void | Promise<void>;
export type Unsubscribe = () => void | Promise<void>;

export interface EventBroker {
  publish(wakeup: EventWakeup): Promise<void>;
  subscribe(listener: EventWakeupListener): Promise<Unsubscribe>;
  close?(): Promise<void>;
}

export class InMemoryEventBroker implements EventBroker {
  private readonly listeners = new Set<EventWakeupListener>();

  get subscriberCount(): number {
    return this.listeners.size;
  }

  async publish(wakeup: EventWakeup): Promise<void> {
    await Promise.all([...this.listeners].map((listener) => listener(wakeup)));
  }

  async subscribe(listener: EventWakeupListener): Promise<Unsubscribe> {
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
    };
  }
}

const channel = "synchronicle_run_events";

export class PostgresEventBroker implements EventBroker {
  private readonly listeners = new Set<EventWakeupListener>();
  private listenPromise: Promise<{ unlisten: () => Promise<void> }> | undefined;

  constructor(private readonly database: Database) {}

  async publish(wakeup: EventWakeup): Promise<void> {
    await this.database.$client.notify(channel, JSON.stringify(wakeup));
  }

  async subscribe(listener: EventWakeupListener): Promise<Unsubscribe> {
    this.listeners.add(listener);
    this.listenPromise ??= this.database.$client.listen(channel, (payload) => {
      let wakeup: EventWakeup;
      try {
        wakeup = JSON.parse(payload) as EventWakeup;
      } catch {
        return;
      }
      if (typeof wakeup.runId !== "string" || !Number.isSafeInteger(wakeup.sequence) || wakeup.sequence < 1) return;
      for (const candidate of this.listeners) void candidate(wakeup);
    }, () => {
      for (const candidate of this.listeners) void candidate({ sequence: Number.MAX_SAFE_INTEGER });
    });
    await this.listenPromise;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    this.listeners.clear();
    const subscription = await this.listenPromise;
    this.listenPromise = undefined;
    await subscription?.unlisten();
  }
}
