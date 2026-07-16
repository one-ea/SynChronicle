import type { EventEmitter } from "node:events";

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
