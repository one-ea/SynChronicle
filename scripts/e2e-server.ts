import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { asc, eq } from "drizzle-orm";
import { createDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { artifacts, chapters, checkpoints, quotaLedger, runEvents, runs, tasks, usageRecords } from "../src/db/schema/index.js";
import { TestProcessOrchestrator } from "./e2e-orchestrator.js";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
await migrateDatabase(databaseUrl);
await import("./e2e-seed.js");
const providerLog = `/tmp/synchronicle-e2e-provider-${process.pid}.jsonl`;
await writeFile(providerLog, "", { mode: 0o600 });

const common = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: databaseUrl,
  PUBLIC_URL: process.env.PUBLIC_URL ?? "http://127.0.0.1:4173",
  SESSION_SECRET: process.env.SESSION_SECRET ?? "e2e-session-secret-that-is-at-least-32-characters",
  PROJECT_CREDENTIAL_MASTER_KEYS: process.env.PROJECT_CREDENTIAL_MASTER_KEYS ?? `v1:${Buffer.alloc(32, "e").toString("base64")}`,
  PROJECT_CREDENTIAL_MASTER_KEY_VERSION: "v1",
  PROJECT_PROVIDER_ALLOWED_HOSTS: "{}",
  CONFIG_PATH: "e2e/fixtures/config.json",
  SYNCHRONICLE_E2E_FAKE_PROVIDER: "1",
  SYNCHRONICLE_E2E_PROVIDER_LOG: providerLog,
  SYNCHRONICLE_E2E_PROVIDER_DELAY_MS: "150",
  E2E_FAKE_KEY: "test-only",
  PORT: "4173",
  WORKER_IDLE_MS: "20",
  WORKER_LEASE_MS: "600",
};

const database = createDatabase(databaseUrl);
const orchestrator = new TestProcessOrchestrator({ env: common });
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  orchestrator.shutdown();
  control.close();
  void database.$client.end();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
orchestrator.startWeb();
orchestrator.startWorker();

const control = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1:4174");
    if (request.method === "GET" && url.pathname === "/processes") return send(response, 200, orchestrator.snapshot());
    if (request.method === "POST" && url.pathname === "/reset") { await writeFile(providerLog, "", { mode: 0o600 }); return send(response, 204, null); }
    if (request.method === "POST" && url.pathname === "/worker/kill") { await orchestrator.killWorker(); return send(response, 200, orchestrator.snapshot()); }
    if (request.method === "POST" && url.pathname === "/worker/start") { orchestrator.startWorker(); return send(response, 201, orchestrator.snapshot()); }
    if (request.method === "POST" && url.pathname === "/prepare-run") {
      const runId = url.searchParams.get("runId");
      const projectId = url.searchParams.get("projectId");
      if (!runId || !projectId) return send(response, 400, { error: "runId and projectId are required" });
      const [run] = await database.select({ userId: runs.userId }).from(runs).where(eq(runs.id, runId)).limit(1);
      if (!run) return send(response, 404, { error: "Run not found" });
      await database.insert(chapters).values({ userId: run.userId, projectId, runId, sequence: 1, title: "潮声抵达前", body: streamTextFixture, status: "complete", version: 1 }).onConflictDoNothing();
      await database.insert(artifacts).values({ userId: run.userId, projectId, runId, type: "meta/progress.json", contentJson: { novel_name: "导入的雾港来信", phase: "complete", current_chapter: 2, total_chapters: 1, completed_chapters: [1], total_word_count: 26, flow: "writing", in_progress_chapter: 0, pending_rewrites: [] }, status: "committed", version: 1 }).onConflictDoNothing();
      return send(response, 201, { prepared: true });
    }
    if (request.method === "GET" && url.pathname === "/state") {
      const runId = url.searchParams.get("runId");
      const projectId = url.searchParams.get("projectId");
      if (!runId) return send(response, 400, { error: "runId is required" });
      const [runRows, taskRows, eventRows, checkpointRows, chapterRows, artifactRows, projectChapterRows, projectArtifactRows, usageRows, quotaRows, providerCalls] = await Promise.all([
        database.select().from(runs).where(eq(runs.id, runId)),
        database.select().from(tasks).where(eq(tasks.runId, runId)),
        database.select().from(runEvents).where(eq(runEvents.runId, runId)).orderBy(asc(runEvents.sequence)),
        database.select().from(checkpoints).where(eq(checkpoints.runId, runId)),
        database.select().from(chapters).where(eq(chapters.runId, runId)),
        database.select().from(artifacts).where(eq(artifacts.runId, runId)),
        projectId ? database.select().from(chapters).where(eq(chapters.projectId, projectId)) : Promise.resolve([]),
        projectId ? database.select().from(artifacts).where(eq(artifacts.projectId, projectId)) : Promise.resolve([]),
        database.select().from(usageRecords).where(eq(usageRecords.runId, runId)),
        database.select().from(quotaLedger).where(eq(quotaLedger.runId, runId)),
        readProviderCalls(providerLog),
      ]);
      return send(response, 200, { run: runRows[0] ?? null, tasks: taskRows, events: eventRows, checkpoints: checkpointRows, chapters: chapterRows, artifacts: artifactRows, projectChapters: projectChapterRows, projectArtifacts: projectArtifactRows, usage: usageRows, quota: quotaRows, providerCalls, processes: orchestrator.snapshot() });
    }
    return send(response, 404, { error: "Not Found" });
  } catch (error) {
    return send(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});
control.listen(4174, "127.0.0.1");

function send(response: import("node:http").ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readProviderCalls(path: string) {
  const value = await readFile(path, "utf8");
  return value.trim() ? value.trim().split("\n").map((line) => JSON.parse(line)) : [];
}

const streamTextFixture = "# 潮声抵达前\n\n她在码头读完第一封信。";
