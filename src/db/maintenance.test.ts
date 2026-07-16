import { describe, expect, it, vi } from "vitest";
import { withMigrationLock } from "./maintenance.js";

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
