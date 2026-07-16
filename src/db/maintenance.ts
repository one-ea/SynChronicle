import { sql as drizzleSql } from "drizzle-orm";
import postgres from "postgres";
import { DatabaseQuotaLedger } from "../quota/ledger.js";
import { createDatabase } from "./client.js";
import { migrateDatabase } from "./migrate.js";

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
    const rows = await database.execute(drizzleSql`select 1 where to_regclass('drizzle.__drizzle_migrations') is not null`);
    if (rows.length === 0) throw new Error("database migrations are incomplete");
  } finally {
    await database.$client.end();
  }
}
