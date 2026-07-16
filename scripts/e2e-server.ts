import { spawn, type ChildProcess } from "node:child_process";
import { migrateDatabase } from "../src/db/migrate.js";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
await migrateDatabase(databaseUrl);
await import("./e2e-seed.js");

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
  E2E_FAKE_KEY: "test-only",
  PORT: "4173",
  WORKER_IDLE_MS: "20",
  WORKER_LEASE_MS: "600",
};

const children: ChildProcess[] = [];
function start(entry: string) {
  const child = spawn(process.execPath, [entry], { env: common, stdio: "inherit" });
  children.push(child);
  child.once("exit", (code) => { if (!stopping) { process.exitCode = code || 1; stop(); } });
}
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => child.kill("SIGTERM"));
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
start("dist/web/main.js");
start("dist/worker/main.js");
await new Promise<void>((resolve) => process.once("beforeExit", resolve));
