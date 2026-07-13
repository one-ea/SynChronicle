import { describe, expect, it } from "vitest";
import * as domain from "./index.js";

const fixtures: Array<[string, { safeParse(value: unknown): { success: boolean } }, unknown]> = [
  ["Novel", domain.NovelSchema, { name: "Test", total_chapters: 10 }],
  ["Progress", domain.ProgressSchema, { novel_name: "Test", phase: "writing", current_chapter: 1, total_chapters: 10, completed_chapters: [], total_word_count: 0 }],
  ["Checkpoint", domain.CheckpointSchema, { seq: 1, scope: { kind: "chapter", chapter: 1 }, step: "draft", occurred_at: "2026-07-12T00:00:00Z" }],
  ["UsageState", domain.UsageStateSchema, { schema: 2, updated_at: "2026-07-12T00:00:00Z", overall: { input: 0, output: 0, cache_read: 0, cache_write: 0, cost_usd: 0, saved_usd: 0, cache_capable: false }, per_agent: {}, missing_assistant_usage: 0 }],
  ["CastEntry", domain.CastEntrySchema, { name: "Alice", first_seen_chapter: 1, last_seen_chapter: 1, appearance_count: 1, appearance_chapters: [1] }],
  ["RuntimeQueueItem", domain.RuntimeQueueItemSchema, { seq: 1, time: "2026-07-12T00:00:00Z", kind: "ui_event", priority: "control" }],
];

describe("Go JSON persistence compatibility", () => {
  it.each(fixtures)("parses %s using exact Go json tags", (_name, schema, fixture) => {
    expect(schema.safeParse(fixture).success).toBe(true);
  });

  it("rejects exported Go field names as persistence keys", () => {
    expect(domain.NovelSchema.safeParse({ Name: "Test", TotalChapters: 10 }).success).toBe(false);
  });

  it("keeps latency optional for persisted usage written before reviewer timing", () => {
    const legacy = fixtures.find(([name]) => name === "UsageState")?.[2];
    const parsed = domain.UsageStateSchema.parse(legacy);
    expect(parsed.overall.latency_ms).toBeUndefined();
  });

  it("exports every Task 3 domain module", () => {
    for (const name of [
      "TransitionSchema", "TransitionsSchema", "RuntimeEventSchema", "BundleSchema",
      "CocreateConfigSchema", "DecisionSchema", "CommandResultSchema", "AliasModelSchema",
    ]) expect(domain[name as keyof typeof domain]).toBeDefined();
  });
});
