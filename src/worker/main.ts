import { randomUUID } from "node:crypto";
import { loadAssets } from "../assets/load.js";
import { loadConfig } from "../config/index.js";
import { createDatabase } from "../db/client.js";
import { Host } from "../runtime/host.js";
import { SchedulerRepository } from "../scheduler/repository.js";
import { DatabaseStore } from "../store/database/index.js";
import { WorkerRunner, taskFingerprint } from "./runner.js";

export async function startWorker(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const workerId = process.env.WORKER_ID?.trim() || randomUUID();
  const leaseMs = positiveInteger(process.env.WORKER_LEASE_MS, 30_000, "WORKER_LEASE_MS");
  const idleMs = positiveInteger(process.env.WORKER_IDLE_MS, 1_000, "WORKER_IDLE_MS");
  const database = createDatabase(databaseUrl);
  const scheduler = new SchedulerRepository(database);
  const config = await loadConfig(process.env.CONFIG_PATH);
  const bundle = loadAssets(config.style);
  const runner = new WorkerRunner({
    scheduler,
    workerId,
    leaseMs,
    idleMs,
    createHost: async (task) => Host.new(config, bundle, {
      store: new DatabaseStore(database, {
        userId: task.userId,
        projectId: task.projectId,
        runId: task.runId,
        taskFingerprint: taskFingerprint(task),
      }),
    }),
  });
  const controller = new AbortController();
  const shutdown = () => controller.abort(new Error("worker shutdown"));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  try {
    await runner.run(controller.signal);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
  }
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

if (import.meta.url === `file://${process.argv[1]}`) await startWorker();
