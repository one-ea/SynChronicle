import Fastify, { type FastifyInstance } from "fastify";
import type { WebConfig } from "./config.js";

export type WebServerOptions = Pick<WebConfig, "databaseUrl">;

export async function buildWebServer(_options: WebServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, trustProxy: true });
  app.get("/api/health", async () => ({ status: "ok" as const }));
  return app;
}
