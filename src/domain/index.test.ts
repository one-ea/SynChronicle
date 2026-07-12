import { describe, it, expect } from "vitest";

describe("domain types are importable", () => {
  it("exports all modules from barrel", async () => {
    const domain = await import("./index.js");
    expect(domain.NovelSchema).toBeDefined();
    expect(domain.ProgressSchema).toBeDefined();
    expect(domain.CheckpointSchema).toBeDefined();
    expect(domain.CastEntrySchema).toBeDefined();
    expect(domain.SimulationProfileSchema).toBeDefined();
    expect(domain.UsageStateSchema).toBeDefined();
    expect(domain.RuntimeQueueItemSchema).toBeDefined();
  });
});