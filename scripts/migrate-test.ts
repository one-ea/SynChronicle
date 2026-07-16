import { migrateDatabase } from "../src/db/migrate.js";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
await migrateDatabase(databaseUrl);
