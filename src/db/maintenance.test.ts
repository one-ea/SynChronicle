import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assertMigrationsApplied, databaseUrlForName, loadExpectedMigrations, parseMaintenanceArgs, withMigrationLock } from "./maintenance.js";

describe("withMigrationLock", () => {
  it("holds the advisory lock until migrations complete", async () => {
    const events: string[] = [];
    const lock = vi.fn(async () => { events.push("lock"); });
    const migrate = vi.fn(async () => { events.push("migrate"); });
    const unlock = vi.fn(async () => { events.push("unlock"); });

    await withMigrationLock({ lock, migrate, unlock });

    expect(events).toEqual(["lock", "migrate", "unlock"]);
  });

  it("releases the advisory lock when migration fails", async () => {
    const unlock = vi.fn(async () => undefined);

    await expect(withMigrationLock({
      lock: async () => undefined,
      migrate: async () => { throw new Error("migration failed"); },
      unlock,
    })).rejects.toThrow("migration failed");
    expect(unlock).toHaveBeenCalledOnce();
  });
});

describe("maintenance command parsing", () => {
  it("parses credential dry-run and bounded batches without accepting unknown options", () => {
    expect(parseMaintenanceArgs(["credential-reencrypt", "--dry-run", "--batch-size=25"])).toEqual({ command: "credential-reencrypt", dryRun: true, batchSize: 25 });
    expect(() => parseMaintenanceArgs(["credential-reencrypt", "--batch-size=0"])).toThrow("batch size");
    expect(() => parseMaintenanceArgs(["credential-reencrypt", "--secret=value"])).toThrow("unsupported option");
  });
});

describe("databaseUrlForName", () => {
  it("overrides only the validated database path", () => {
    expect(databaseUrlForName("postgres://user:secret@postgres:5432/current?sslmode=disable", "restored_20260716")).toBe("postgres://user:secret@postgres:5432/restored_20260716?sslmode=disable");
    expect(() => databaseUrlForName("postgres://user:secret@postgres/current", "prod;drop database prod")).toThrow("database name");
  });
});

describe("migration readiness", () => {
  it("requires every journal migration hash and created_at value", async () => {
    const folder = await mkdtemp(join(tmpdir(), "synchronicle-migrations-"));
    await writeFile(join(folder, "0000_first.sql"), "select 1;\n");
    await writeFile(join(folder, "0001_second.sql"), "select 2;\n");
    await writeFile(join(folder, "_journal.json"), JSON.stringify({ entries: [
      { idx: 0, when: 1000, tag: "0000_first" },
      { idx: 1, when: 2000, tag: "0001_second" },
    ] }));
    const expected = await loadExpectedMigrations(folder, join(folder, "_journal.json"));

    expect(expected).toHaveLength(2);
    expect(() => assertMigrationsApplied(expected, [expected[0]!])).toThrow("0001_second");
    expect(() => assertMigrationsApplied(expected, [
      expected[0]!,
      { ...expected[1]!, hash: "wrong" },
    ])).toThrow("0001_second");
    expect(() => assertMigrationsApplied(expected, expected)).not.toThrow();
  });
});
