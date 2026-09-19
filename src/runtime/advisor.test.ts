import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../store/index.js";
import { computeAdvice } from "./advisor.js";

describe("computeAdvice", () => {
  it("emits deterministic preparation, constitution, queue, and budget advice", async () => {
    const store = new Store(await mkdtemp(join(tmpdir(), "advisor-"))); await store.init();
    const advice = await computeAdvice(store, { prepStage: "premise", autopilotPhase: "writing", budgetUsd: 10, costUsd: 8, reviewQueue: [1, 2, 3] });
    expect(advice.map((item) => item.kind)).toEqual(expect.arrayContaining(["prep-missing-conflict", "prep-outline-empty", "constitution-empty", "review-queue-growing", "budget-usage-high"]));
  });
  it("honors dismissed ids", async () => {
    const store = new Store(await mkdtemp(join(tmpdir(), "advisor-dismiss-"))); await store.init();
    await store.writeArtifact("meta/advice.json", { dismissed: ["prep-missing-conflict:book"], updatedAt: "now" });
    expect((await computeAdvice(store, { prepStage: "intent" })).some((item) => item.kind === "prep-missing-conflict")).toBe(false);
  });
});
