import { randomUUID } from "node:crypto";
import { loadAssets } from "../assets/load.js";
import { loadConfig } from "../config/index.js";
import { createDatabase } from "../db/client.js";
import { Host } from "../runtime/host.js";
import { PostgresEventBroker } from "../realtime/broker.js";
import { DatabaseEventRepository } from "../realtime/eventRepository.js";
import { SchedulerRepository } from "../scheduler/repository.js";
import { DatabaseStore } from "../store/database/index.js";
import { WorkerRunner, taskFingerprint } from "./runner.js";
import { applyRunConfiguration } from "./configuration.js";
import { CredentialService } from "../credentials/service.js";
import { DatabaseCredentialRepository } from "../credentials/database.js";
import { masterKeyRegistryFromEnvironment } from "../credentials/envelope.js";
import { createProvider, credentialScopedModel } from "../providers/index.js";
import { parseProviderAllowedHosts } from "../providers/urlPolicy.js";
import { platformModels } from "../db/schema/index.js";
import { and, eq } from "drizzle-orm";
import { DatabaseQuotaLedger, startQuotaMaintenance } from "../quota/ledger.js";
import { quotaGuardedModel } from "../quota/model.js";
import { platformCredentialModel, platformCredentialSource } from "../quota/platformCredential.js";
import { hasKnownPlatformPrice } from "../quota/pricing.js";
import { writeFile, unlink } from "node:fs/promises";

export async function startWorker(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const workerId = process.env.WORKER_ID?.trim() || randomUUID();
  const leaseMs = positiveInteger(process.env.WORKER_LEASE_MS, 30_000, "WORKER_LEASE_MS");
  const idleMs = positiveInteger(process.env.WORKER_IDLE_MS, 1_000, "WORKER_IDLE_MS");
  const database = createDatabase(databaseUrl);
  const providerAllowedHosts = parseProviderAllowedHosts(process.env.PROJECT_PROVIDER_ALLOWED_HOSTS);
  const credentialService = new CredentialService(new DatabaseCredentialRepository(database), masterKeyRegistryFromEnvironment(process.env.PROJECT_CREDENTIAL_MASTER_KEYS, process.env.PROJECT_CREDENTIAL_MASTER_KEY_VERSION), undefined, providerAllowedHosts);
  const events = new DatabaseEventRepository(database);
  const eventBroker = new PostgresEventBroker(database);
  const scheduler = new SchedulerRepository(database, { eventBroker });
  const quotaLedger = new DatabaseQuotaLedger(database);
  await quotaLedger.reconcile({ olderThan: new Date(Date.now() - leaseMs * 2) });
  const stopQuotaMaintenance = startQuotaMaintenance(quotaLedger, { intervalMs: Math.max(5_000, leaseMs), staleAfterMs: leaseMs * 2 });
  const config = await loadConfig(process.env.CONFIG_PATH);
  const bundle = loadAssets(config.style);
  const runner = new WorkerRunner({
    scheduler,
    workerId,
    leaseMs,
    idleMs,
    eventSink: {
      appendEvent: (scope, event) => events.appendEvent(scope, event),
      publish: (wakeup) => eventBroker.publish(wakeup),
    },
    createHost: async (task) => {
      const runConfig = applyRunConfiguration(config, task.payload);
      return Host.new(runConfig, bundle, {
        nextModelInvocation: async ({ agent, kind, logicalKey }) => (await quotaLedger.allocateModelCall({ taskId: task.id, runId: task.runId, scope: `${agent}:${kind}`, invocationKey: logicalKey, leaseVersion: task.leaseVersion })).id,
        modelFactory: (provider, model, selection) => {
          if (selection?.credentialId) return credentialScopedModel(provider, model, selection.credentialId, runConfig.providers?.[provider] ?? {}, async (credentialId, expectedProvider) => {
            const secret = await credentialService.resolve(task.userId, credentialId, { runId: task.runId });
            if (!secret || secret.provider !== expectedProvider) throw new Error("credential is unavailable for this provider");
            const lease = { apiKey: secret.apiKey, baseUrl: secret.baseUrl, release() { lease.apiKey = ""; lease.baseUrl = undefined; secret.apiKey = ""; secret.baseUrl = undefined; } };
            return lease;
          }, (name, providerConfig, selectedModel, factories) => createProvider(name, providerConfig, selectedModel, factories, providerAllowedHosts));
          const loadPlatformModel = async () => { const [configured] = await database.select().from(platformModels).where(and(eq(platformModels.provider, provider), eq(platformModels.model, model), eq(platformModels.status, "active"))).limit(1); return configured && hasKnownPlatformPrice(configured.metadata, configured.inputPrice, configured.outputPrice) ? configured : undefined; };
          const platformModel = platformCredentialModel({ provider, model, runId: task.runId, base: runConfig.providers?.[provider] ?? {}, load: loadPlatformModel, environment: process.env, credentials: credentialService, factory: (name, providerConfig, selectedModel) => createProvider(name, providerConfig, selectedModel, {}, providerAllowedHosts) }) as never;
          return quotaGuardedModel({ provider, modelName: model, userId: task.userId, projectId: task.projectId, runId: task.runId, taskId: task.id, leaseVersion: task.leaseVersion, agent: task.type, resolvePricing: async () => { const configured = await loadPlatformModel(); return configured ? { inputPrice: Number(configured.inputPrice), outputPrice: Number(configured.outputPrice), priceSource: "platform", credentialSource: platformCredentialSource(configured.credentialReference) } : null; }, ledger: quotaLedger, model: platformModel });
        },
        persistStreamDelta: async (chunkSequence, text) => {
          const event = await events.appendEvent({ userId: task.userId, projectId: task.projectId, runId: task.runId }, {
            stableId: `stream:${task.runId}:${task.id}:${task.type}:${chunkSequence}`,
            type: "stream.delta",
            payload: { taskId: task.id, agent: task.type, chunkSequence, text },
          });
          return { sequence: chunkSequence, text, eventSequence: event.sequence };
        },
        store: new DatabaseStore(database, {
          userId: task.userId,
          projectId: task.projectId,
          runId: task.runId,
          taskFingerprint: taskFingerprint(task),
          projectVersion: task.projectVersion,
          lease: { taskId: task.id, owner: workerId, version: task.leaseVersion },
        }),
      });
    },
  });
  const controller = new AbortController();
  const healthFile = process.env.WORKER_HEALTH_FILE ?? "/tmp/synchronicle-worker-ready";
  await writeFile(healthFile, workerId, { mode: 0o600 });
  const shutdown = () => controller.abort(new Error("worker shutdown"));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  try {
    await runner.run(controller.signal);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    await unlink(healthFile).catch(() => undefined);
    stopQuotaMaintenance();
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    await eventBroker.close();
    await database.$client.end();
  }
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

if (import.meta.url === `file://${process.argv[1]}`) await startWorker();
