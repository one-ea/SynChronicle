import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "./client.js";

export async function migrateDatabase(databaseUrl: string): Promise<void> {
  const database = createDatabase(databaseUrl);
  try {
    await migrate(database, { migrationsFolder: "drizzle" });
  } finally {
    await database.$client.end();
  }
}
