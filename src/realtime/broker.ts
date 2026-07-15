import type { Database } from "../db/client.js";

export interface EventWakeup {
  runId?: string;
  sequence: number;
}

export type EventWakeupListener = (wakeup: EventWakeup) => void | Promise<void>;
export type EventBrokerErrorListener = (error: Error) => void | Promise<void>;
export type Unsubscribe = () => void | Promise<void>;

export interface EventBroker {
  publish(wakeup: EventWakeup): Promise<void>;
  subscribe(listener: EventWakeupListener, onError?: EventBrokerErrorListener): Promise<Unsubscribe>;
  close?(): Promise<void>;
}

export class InMemoryEventBroker implements EventBroker {
  private readonly listeners = new Set<BrokerSubscriber>();

  get subscriberCount(): number {
    return this.listeners.size;
  }

  async publish(wakeup: EventWakeup): Promise<void> {
    await Promise.all([...this.listeners].map((subscriber) => dispatch(subscriber, wakeup)));
  }

  async subscribe(listener: EventWakeupListener, onError?: EventBrokerErrorListener): Promise<Unsubscribe> {
    const subscriber = { listener, onError };
    this.listeners.add(subscriber);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(subscriber);
    };
  }
}

const channel = "synchronicle_run_events";

export class PostgresEventBroker implements EventBroker {
  private readonly listeners = new Set<BrokerSubscriber>();
  private listenPromise: Promise<{ unlisten: () => Promise<void> }> | undefined;

  constructor(private readonly database: Database) {}

  get subscriberCount(): number {
    return this.listeners.size;
  }

  async publish(wakeup: EventWakeup): Promise<void> {
    await this.database.$client.notify(channel, JSON.stringify(wakeup));
  }

  async subscribe(listener: EventWakeupListener, onError?: EventBrokerErrorListener): Promise<Unsubscribe> {
    const subscriber = { listener, onError };
    this.listeners.add(subscriber);
    const listening = this.listenPromise ??= this.database.$client.listen(channel, (payload) => {
      let wakeup: EventWakeup;
      try {
        wakeup = JSON.parse(payload) as EventWakeup;
      } catch {
        return;
      }
      if (typeof wakeup.runId !== "string" || !Number.isSafeInteger(wakeup.sequence) || wakeup.sequence < 1) return;
      for (const candidate of this.listeners) void dispatch(candidate, wakeup);
    }, () => {
      for (const candidate of this.listeners) void dispatch(candidate, { sequence: Number.MAX_SAFE_INTEGER });
    });
    try {
      await listening;
    } catch (error) {
      this.listeners.delete(subscriber);
      if (this.listenPromise === listening) this.listenPromise = undefined;
      throw error;
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(subscriber);
    };
  }

  async close(): Promise<void> {
    this.listeners.clear();
    const listening = this.listenPromise;
    this.listenPromise = undefined;
    const subscription = await listening?.catch(() => undefined);
    await subscription?.unlisten();
  }
}

interface BrokerSubscriber {
  listener: EventWakeupListener;
  onError?: EventBrokerErrorListener;
}

async function dispatch(subscriber: BrokerSubscriber, wakeup: EventWakeup): Promise<void> {
  try {
    await subscriber.listener(wakeup);
  } catch (error) {
    try {
      await subscriber.onError?.(error instanceof Error ? error : new Error(String(error)));
    } catch {
      // Error handlers are terminal notifications and cannot escape the broker.
    }
  }
}
