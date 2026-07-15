import Fastify, { type FastifyInstance } from "fastify";
import { createDatabase, type Database } from "../db/client.js";
import { authPlugin } from "./auth/plugin.js";
import { AuditRepository } from "./audit/repository.js";
import type { WebConfig } from "./config.js";
import { ProjectRepository } from "./projects/repository.js";
import { projectRoutes } from "./projects/routes.js";

type WebServerCommonOptions = Partial<Pick<WebConfig, "publicUrl" | "trustProxy">>;

export type WebServerOptions = WebServerCommonOptions & (
  | { databaseUrl: string; database?: never; databaseOwnership?: never }
  | { database: Database; databaseOwnership: "owned" | "borrowed"; databaseUrl?: never }
);

export async function buildWebServer(options: WebServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, trustProxy: options.trustProxy ?? false });
  const database = options.database ?? createDatabase(options.databaseUrl);
  const ownsDatabase = options.database ? options.databaseOwnership === "owned" : true;
  if (ownsDatabase) {
    app.addHook("onClose", async () => {
      await database.$client.end();
    });
  }
  await app.register(authPlugin, {
    db: database,
    publicUrl: options.publicUrl ?? "http://localhost:3000",
  });
  await app.register(projectRoutes, {
    prefix: "/api/projects",
    repository: new ProjectRepository(database),
    audit: new AuditRepository(database),
  });
  app.get("/api/health", async () => ({ status: "ok" as const }));
  return app;
}
