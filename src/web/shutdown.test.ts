import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { installGracefulShutdown } from "./shutdown.js";

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
