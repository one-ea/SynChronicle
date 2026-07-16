import { checkDatabaseReadiness, databaseUrlForName, migrateWithLock, parseMaintenanceArgs, reconcileQuota, waitForDatabase } from "./maintenance.js";
import { createDatabase } from "./client.js";
import { masterKeyRegistryFromEnvironment } from "../credentials/envelope.js";
import { rotateDatabaseCredentials } from "../credentials/rotation.js";

function databaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required");
  const override = process.env.DATABASE_NAME_OVERRIDE?.trim();
  return override ? databaseUrlForName(value, override) : value;
}

async function main(): Promise<void> {
  const { command, dryRun, batchSize } = parseMaintenanceArgs(process.argv.slice(2));
  if (command === "--help" || command === "help" || process.argv.includes("--help")) {
    console.log("usage: maintenance <wait|migrate|ready|quota-reconcile|credential-reencrypt> [--dry-run] [--batch-size=N]");
    return;
  }
  if (command === "wait") return waitForDatabase(databaseUrl(), Number(process.env.DB_WAIT_TIMEOUT_MS ?? 60_000));
  if (command === "migrate") return migrateWithLock(databaseUrl());
  if (command === "ready") return checkDatabaseReadiness(databaseUrl());
  if (command === "quota-reconcile") {
    const count = await reconcileQuota(databaseUrl(), Number(process.env.QUOTA_STALE_AFTER_MS ?? 60_000));
    console.log(`reconciled ${count} quota reservations`);
    return;
  }
  if (command === "credential-reencrypt") {
    const database = createDatabase(databaseUrl());
    try {
      const result = await rotateDatabaseCredentials(database, masterKeyRegistryFromEnvironment(process.env.PROJECT_CREDENTIAL_MASTER_KEYS, process.env.PROJECT_CREDENTIAL_MASTER_KEY_VERSION), { dryRun, batchSize });
      console.log(`credential re-encryption ${dryRun ? "dry-run " : ""}examined=${result.examined} rotated=${result.rotated} skipped=${result.skipped}`);
    } finally {
      await database.$client.end();
    }
    return;
  }
  throw new Error(`unsupported maintenance command: ${command ?? ""}`);
}

await main();
