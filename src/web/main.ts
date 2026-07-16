import { loadWebConfig } from "./config.js";
import { buildWebServer } from "./server.js";
import { drainAndClose, installGracefulShutdown, parseShutdownDrainMs } from "./shutdown.js";

export async function startWebServer(): Promise<void> {
  const config = loadWebConfig();
  const app = await buildWebServer(config);
  const drainMs = parseShutdownDrainMs(process.env.SHUTDOWN_DRAIN_MS);
  const removeShutdownHandlers = installGracefulShutdown(process, () => drainAndClose({
    gate: app.readinessGate,
    closeSockets: () => app.websocketServer.clients.forEach((client: { close: (code: number, reason: string) => void }) => client.close(1012, "server restart")),
    closeServer: () => app.close(),
    drainMs,
  }));
  app.addHook("onClose", async () => removeShutdownHandlers());
  await app.listen({ host: config.host, port: config.port });
}

if (import.meta.url === `file://${process.argv[1]}`) await startWebServer();
