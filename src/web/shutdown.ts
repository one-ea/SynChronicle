import type { EventEmitter } from "node:events";

export type ReadinessGate = { check: () => Promise<void>; beginDrain: () => void; isDraining: () => boolean };

export function createReadinessGate(checkDependency: () => Promise<void>): ReadinessGate {
  let draining = false;
  return {
    check: async () => {
      if (draining) throw new Error("server is draining");
      await checkDependency();
    },
    beginDrain: () => { draining = true; },
    isDraining: () => draining,
  };
}

export async function drainAndClose(options: { gate: ReadinessGate; closeSockets: () => void; closeServer: () => Promise<void>; drainMs: number; sleep?: (ms: number) => Promise<void> }): Promise<void> {
  options.gate.beginDrain();
  options.closeSockets();
  await (options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(options.drainMs);
  await options.closeServer();
}

export function installGracefulShutdown(signals: Pick<EventEmitter, "once" | "removeListener">, close: () => Promise<void>): () => void {
  let closing: Promise<void> | undefined;
  const shutdown = () => {
    closing ??= close();
    void closing.catch((error) => {
      console.error("graceful shutdown failed", error);
      process.exitCode = 1;
    });
  };
  signals.once("SIGINT", shutdown);
  signals.once("SIGTERM", shutdown);
  return () => {
    signals.removeListener("SIGINT", shutdown);
    signals.removeListener("SIGTERM", shutdown);
  };
}
