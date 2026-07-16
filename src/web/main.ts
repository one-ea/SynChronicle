import { loadWebConfig } from "./config.js";
import { buildWebServer } from "./server.js";
import { installGracefulShutdown } from "./shutdown.js";

export async function startWebServer(): Promise<void> {
  const config = loadWebConfig();
  const app = await buildWebServer(config);
  const removeShutdownHandlers = installGracefulShutdown(process, () => app.close());
  app.addHook("onClose", async () => removeShutdownHandlers());
  await app.listen({ host: config.host, port: config.port });
}

if (import.meta.url === `file://${process.argv[1]}`) await startWebServer();
