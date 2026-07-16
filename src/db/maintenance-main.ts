import { migrateWithLock, reconcileQuota, waitForDatabase } from "./maintenance.js";

function databaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required");
  return value;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "wait") return waitForDatabase(databaseUrl(), Number(process.env.DB_WAIT_TIMEOUT_MS ?? 60_000));
  if (command === "migrate") return migrateWithLock(databaseUrl());
  if (command === "quota-reconcile") {
    const count = await reconcileQuota(databaseUrl(), Number(process.env.QUOTA_STALE_AFTER_MS ?? 60_000));
    console.log(`reconciled ${count} quota reservations`);
    return;
  }
  throw new Error(`unsupported maintenance command: ${command ?? ""}`);
}

await main();
