import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createReadinessGate, drainAndClose, installGracefulShutdown, parseShutdownDrainMs } from "./shutdown.js";

describe("installGracefulShutdown", () => {
  it("closes the server once on termination signals", async () => {
    const signals = new EventEmitter();
    const close = vi.fn(async () => undefined);
    const remove = installGracefulShutdown(signals, close);

    signals.emit("SIGTERM");
    signals.emit("SIGINT");
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());

    remove();
    expect(signals.listenerCount("SIGTERM")).toBe(0);
    expect(signals.listenerCount("SIGINT")).toBe(0);
  });
});

describe("parseShutdownDrainMs", () => {
  it("accepts finite non-negative integers up to 30 seconds", () => {
    expect(parseShutdownDrainMs(undefined)).toBe(5_000);
    expect(parseShutdownDrainMs("0")).toBe(0);
    expect(parseShutdownDrainMs("30000")).toBe(30_000);
    for (const value of ["-1", "30001", "1.5", "Infinity", "NaN", ""] ) {
      expect(() => parseShutdownDrainMs(value)).toThrow("SHUTDOWN_DRAIN_MS");
    }
  });
});

describe("drainAndClose", () => {
  it("marks readiness unavailable before closing websockets and the listener", async () => {
    const events: string[] = [];
    const gate = createReadinessGate(async () => undefined);
    const closeSockets = vi.fn(() => { events.push("websockets"); });
    const closeServer = vi.fn(async () => { events.push("server"); });

    await drainAndClose({
      gate,
      closeSockets,
      closeServer,
      drainMs: 1,
      sleep: async () => { events.push(gate.isDraining() ? "not-ready" : "ready"); },
    });

    expect(events).toEqual(["websockets", "not-ready", "server"]);
    await expect(gate.check()).rejects.toThrow("draining");
  });
});
