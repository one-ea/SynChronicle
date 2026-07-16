import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sql as drizzleSql } from "drizzle-orm";
import postgres from "postgres";
import { DatabaseQuotaLedger } from "../quota/ledger.js";
import { createDatabase } from "./client.js";
import type { Database } from "./client.js";
import { migrateDatabase } from "./migrate.js";
import { migrationsFolder } from "./migrate.js";

const migrationLockId = 738_921_417;

export async function withMigrationLock(steps: {
  lock: () => Promise<unknown>;
  migrate: () => Promise<unknown>;
  unlock: () => Promise<unknown>;
}): Promise<void> {
  await steps.lock();
  try {
    await steps.migrate();
  } finally {
    await steps.unlock();
  }
}

export async function waitForDatabase(databaseUrl: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const client = postgres(databaseUrl, { max: 1, connect_timeout: 5 });
    try {
      await client`select 1`;
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await client.end({ timeout: 1 }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw new Error("database did not become ready before timeout", { cause: lastError });
}

export async function migrateWithLock(databaseUrl: string): Promise<void> {
  const lockClient = postgres(databaseUrl, { max: 1 });
  try {
    await withMigrationLock({
      lock: () => lockClient`select pg_advisory_lock(${migrationLockId})`,
      migrate: () => migrateDatabase(databaseUrl),
      unlock: () => lockClient`select pg_advisory_unlock(${migrationLockId})`,
    });
  } finally {
    await lockClient.end();
  }
}

export async function reconcileQuota(databaseUrl: string, staleAfterMs: number): Promise<number> {
  const database = createDatabase(databaseUrl);
  try {
    return await new DatabaseQuotaLedger(database).reconcile({ olderThan: new Date(Date.now() - staleAfterMs) });
  } finally {
    await database.$client.end();
  }
}

export async function checkDatabaseReadiness(databaseUrl: string): Promise<void> {
  const database = createDatabase(databaseUrl);
  try {
    await checkAppliedMigrations(database);
  } finally {
    await database.$client.end();
  }
}

export type ExpectedMigration = { tag: string; hash: string; createdAt: number };

export async function loadExpectedMigrations(folder = migrationsFolder, journalPath = join(folder, "meta", "_journal.json")): Promise<ExpectedMigration[]> {
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as { entries?: Array<{ tag: string; when: number }> };
  return Promise.all((journal.entries ?? []).map(async (entry) => ({
    tag: entry.tag,
    hash: createHash("sha256").update(await readFile(join(folder, `${entry.tag}.sql`))).digest("hex"),
    createdAt: entry.when,
  })));
}

export function assertMigrationsApplied(expected: ExpectedMigration[], applied: Array<{ hash: string; createdAt: number | string }>): void {
  const appliedKeys = new Set(applied.map((migration) => `${migration.hash}:${Number(migration.createdAt)}`));
  const missing = expected.filter((migration) => !appliedKeys.has(`${migration.hash}:${migration.createdAt}`));
  if (missing.length) throw new Error(`database migrations are incomplete: ${missing.map((migration) => migration.tag).join(", ")}`);
}

export async function checkAppliedMigrations(database: Database): Promise<void> {
  const expected = await loadExpectedMigrations();
  const table = await database.execute(drizzleSql`select to_regclass('drizzle.__drizzle_migrations') as name`);
  if (!table[0]?.name) throw new Error("database migrations are incomplete: migration table missing");
  const applied = await database.execute(drizzleSql`select hash, created_at as "createdAt" from drizzle.__drizzle_migrations`);
  assertMigrationsApplied(expected, applied as unknown as Array<{ hash: string; createdAt: string }>);
}

export type MaintenanceArgs = { command: string; dryRun: boolean; batchSize: number };

export function parseMaintenanceArgs(args: string[]): MaintenanceArgs {
  const command = args[0] ?? "help";
  const options = args.slice(1);
  for (const option of options) {
    if (option !== "--dry-run" && option !== "--help" && !option.startsWith("--batch-size=")) throw new Error(`unsupported option: ${option}`);
  }
  const batchArgument = options.find((argument) => argument.startsWith("--batch-size="));
  const batchSize = Number(batchArgument?.slice("--batch-size=".length) ?? 100);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error("batch size must be between 1 and 1000");
  return { command, dryRun: options.includes("--dry-run"), batchSize };
}
