import { describe, expect, it, vi } from "vitest";
import { InMemoryEventBroker, PostgresEventBroker } from "./broker.js";
import type { Database } from "../db/client.js";

describe("event broker failure handling", () => {
  it("reports async listener failures without an unhandled rejection", async () => {
    const broker = new InMemoryEventBroker();
    const failure = new Error("subscriber failed");
    const onError = vi.fn();
    await broker.subscribe(async () => { throw failure; }, onError);

    await expect(broker.publish({ runId: "run-1", sequence: 1 })).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("rolls back a failed initial LISTEN and permits a later retry", async () => {
    const unlisten = vi.fn().mockResolvedValue(undefined);
    const listen = vi.fn()
      .mockRejectedValueOnce(new Error("listen unavailable"))
      .mockResolvedValueOnce({ unlisten });
    const broker = new PostgresEventBroker({ $client: { listen, notify: vi.fn() } } as unknown as Database);
    const first = vi.fn();

    await expect(broker.subscribe(first, vi.fn())).rejects.toThrow("listen unavailable");
    expect(broker.subscriberCount).toBe(0);
    const unsubscribe = await broker.subscribe(vi.fn(), vi.fn());
    expect(listen).toHaveBeenCalledTimes(2);
    expect(broker.subscriberCount).toBe(1);

    await unsubscribe();
    await broker.close();
    expect(unlisten).toHaveBeenCalledOnce();
    expect(broker.subscriberCount).toBe(0);
  });

  it("reports rejected PostgreSQL listeners and clears every subscriber on close", async () => {
    let notify!: (payload: string) => void;
    const unlisten = vi.fn().mockResolvedValue(undefined);
    const listen = vi.fn(async (_channel: string, callback: (payload: string) => void) => {
      notify = callback;
      return { unlisten };
    });
    const broker = new PostgresEventBroker({ $client: { listen, notify: vi.fn() } } as unknown as Database);
    const onError = vi.fn();
    await broker.subscribe(async () => { throw new Error("pull failed"); }, onError);
    notify(JSON.stringify({ runId: "run-1", sequence: 1 }));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "pull failed" })));

    await broker.close();
    expect(broker.subscriberCount).toBe(0);
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("wakes every subscriber when PostgreSQL LISTEN reconnects", async () => {
    let onListen!: () => void;
    const listen = vi.fn(async (_channel: string, _callback: (payload: string) => void, ready: () => void) => {
      onListen = ready;
      return { unlisten: vi.fn().mockResolvedValue(undefined) };
    });
    const broker = new PostgresEventBroker({ $client: { listen, notify: vi.fn() } } as unknown as Database);
    const listener = vi.fn().mockResolvedValue(undefined);
    await broker.subscribe(listener, vi.fn());

    onListen();
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith({ sequence: Number.MAX_SAFE_INTEGER }));
    await broker.close();
  });
});
