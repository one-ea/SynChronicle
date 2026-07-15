import Fastify, { type FastifyInstance } from "fastify";
import { createDatabase } from "../db/client.js";
import { authPlugin } from "./auth/plugin.js";
import type { WebConfig } from "./config.js";

export type WebServerOptions = Pick<WebConfig, "databaseUrl"> & Partial<Pick<WebConfig, "publicUrl">>;

export async function buildWebServer(options: WebServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, trustProxy: true });
  await app.register(authPlugin, {
    db: createDatabase(options.databaseUrl),
    publicUrl: options.publicUrl ?? "http://localhost:3000",
  });
  app.get("/api/health", async () => ({ status: "ok" as const }));
  return app;
}
