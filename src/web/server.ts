import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import staticFiles from "@fastify/static";
import { createDatabase, type Database } from "../db/client.js";
import websocket from "@fastify/websocket";
import { PostgresEventBroker } from "../realtime/broker.js";
import { DatabaseEventRepository } from "../realtime/eventRepository.js";
import { SchedulerRepository } from "../scheduler/repository.js";
import { authPlugin } from "./auth/plugin.js";
import { AuditRepository } from "./audit/repository.js";
import type { WebConfig } from "./config.js";
import { ProjectRepository } from "./projects/repository.js";
import { projectRoutes } from "./projects/routes.js";
import {
  asProjectExecutor,
  databaseTransactionRunner,
  ProjectMutationService,
} from "./projects/service.js";
import { runRoutes } from "./runs/routes.js";
import { realtimeRoutes } from "./realtime/routes.js";
import { WorkbenchRepository } from "./workbench/repository.js";
import { workbenchRoutes } from "./workbench/routes.js";
import { ModelConfigurationRepository } from "./providers/repository.js";
import { modelConfigurationRoutes } from "./providers/routes.js";
import { CredentialService } from "../credentials/service.js";
import { DatabaseCredentialRepository } from "../credentials/database.js";
import { masterKeyRegistryFromEnvironment, type MasterKeyRegistry } from "../credentials/envelope.js";
import { createLoginRateLimiter } from "./auth/plugin.js";
import { redactSecrets } from "../credentials/redactor.js";
import { adminRoutes, DatabaseAdminRepository } from "./admin/routes.js";
import { usageRoutes } from "./usage/routes.js";
import { importProjectArchive, exportDatabaseProject } from "../migration/fileProjectImporter.js";
import { importExportRoutes } from "./projects/importExportRoutes.js";

type WebServerCommonOptions = Partial<Pick<WebConfig, "publicUrl" | "trustProxy" | "credentialMasterKeys" | "credentialMasterKeyVersion" | "providerAllowedHosts">> & { staticRoot?: string | null; credentialRegistry?: MasterKeyRegistry };

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type WebServerOptions = WebServerCommonOptions & (
  | { databaseUrl: string; database?: never; databaseOwnership?: never }
  | { database: Database; databaseOwnership: "owned" | "borrowed"; databaseUrl?: never }
);

export async function buildWebServer(options: WebServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
    trustProxy: options.trustProxy ?? false,
    genReqId: (request) => {
      const candidate = request.headers["x-request-id"];
      return typeof candidate === "string" && requestIdPattern.test(candidate) ? candidate : randomUUID();
    },
  });
  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });
  app.setErrorHandler((error, request, reply) => {
    request.log.error(redactSecrets(error), "request failed");
    const statusCode = error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
    void reply.code(statusCode < 500 ? statusCode : 500).send({ error: statusCode < 500 ? "Invalid request" : "Internal Server Error", requestId: request.id });
  });
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
  await app.register(websocket);
  const eventBroker = new PostgresEventBroker(database);
  app.addHook("onClose", async () => eventBroker.close());
  await app.register(realtimeRoutes, {
    repository: new DatabaseEventRepository(database),
    broker: eventBroker,
  });
  const audit = new AuditRepository(database);
  const mutations = new ProjectMutationService(
    databaseTransactionRunner(database),
    (executor) => new ProjectRepository(asProjectExecutor(executor)),
    (executor) => new AuditRepository(asProjectExecutor(executor)),
    audit,
  );
  await app.register(projectRoutes, {
    prefix: "/api/projects",
    repository: new ProjectRepository(database),
    audit,
    mutations,
  });
  await app.register(importExportRoutes, {
    prefix: "/api/projects",
    importer: (userId, source, requestId) => importProjectArchive(database, userId, source, requestId),
    exporter: (userId, projectId, expectedVersion, requestId) => exportDatabaseProject(database, userId, projectId, expectedVersion, requestId),
    auditFailure: (event) => audit.write(event),
  });
  await app.register(runRoutes, {
    prefix: "/api/projects/:projectId/runs",
    repository: new SchedulerRepository(database),
  });
  await app.register(workbenchRoutes, {
    prefix: "/api/projects",
    repository: new WorkbenchRepository(database),
  });
  const credentialRegistry = options.credentialRegistry ?? (options.credentialMasterKeys
    ? masterKeyRegistryFromEnvironment(options.credentialMasterKeys, options.credentialMasterKeyVersion)
    : { currentVersion: "test", keys: new Map([["test", randomBytes(32)]]) });
  const credentialLimiter = createLoginRateLimiter({ max: 20, windowMs: 60_000 });
  await app.register(modelConfigurationRoutes, { prefix: "/api/providers", repository: new ModelConfigurationRepository(database), credentials: new CredentialService(new DatabaseCredentialRepository(database), credentialRegistry, undefined, options.providerAllowedHosts), consumeCredentialMutation: (userId) => credentialLimiter.consume(userId) });
  await app.register(usageRoutes, { prefix: "/api/usage", db: database });
  await app.register(adminRoutes, { prefix: "/api/admin", repository: new DatabaseAdminRepository(database) });
  app.get("/api/health", async () => ({ status: "ok" as const }));
  const clientRoot = options.staticRoot === undefined
    ? resolve(dirname(fileURLToPath(import.meta.url)), "client")
    : options.staticRoot;
  if (clientRoot && existsSync(resolve(clientRoot, "index.html"))) {
    await app.register(staticFiles, { root: clientRoot, prefix: "/" });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith("/api/") || request.url.startsWith("/ws/")) {
        return reply.code(404).send({ error: "Not Found" });
      }
      return reply.type("text/html").sendFile("index.html");
    });
  }
  return app;
}
