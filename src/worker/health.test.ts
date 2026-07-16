import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clearWorkerHealth, prepareWorkerHealth } from "./health.js";

describe("prepareWorkerHealth", () => {
  it("clears an old readiness record before worker initialization", async () => {
    const directory = await mkdtemp(join(tmpdir(), "synchronicle-worker-health-"));
    const path = join(directory, "ready.json");
    await writeFile(path, "stale");

    await clearWorkerHealth(path);

    await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes stale readiness and writes the actual process identity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "synchronicle-worker-health-"));
    const path = join(directory, "ready.json");
    await writeFile(path, JSON.stringify({ pid: 1, nonce: "stale", startedAt: 0 }));

    const health = await prepareWorkerHealth(path, { pid: 4321, now: 123456789, nonce: "fresh-nonce" });
    const payload = JSON.parse(await readFile(path, "utf8"));

    expect(payload).toEqual({ pid: 4321, nonce: "fresh-nonce", startedAt: 123456789 });
    await health.cleanup();
    await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
