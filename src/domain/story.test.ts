import { describe, it, expect } from "vitest";
import { NovelSchema, CharacterSchema, OutlineEntrySchema, VolumeOutlineSchema, ArcOutlineSchema, WorldRuleSchema, StoryCompassSchema } from "./story.js";
describe("story persistence schemas", () => {
  it("parses exact Go json tags", () => {
    expect(NovelSchema.safeParse({ name: "Test Novel", total_chapters: 10 }).success).toBe(true);
    expect(CharacterSchema.safeParse({ name: "Alice", aliases: ["Ally"], role: "protagonist", description: "hero", arc: "growth", traits: ["brave"], tier: "core" }).success).toBe(true);
    expect(OutlineEntrySchema.safeParse({ chapter: 1, title: "Start", core_event: "Begin", hook: "Secret", scenes: [] }).success).toBe(true);
    expect(VolumeOutlineSchema.safeParse({ index: 1, title: "V1", theme: "Discovery", final: false, arcs: [{ index: 1, title: "A1", goal: "Find", estimated_chapters: 5, chapters: [] }] }).success).toBe(true);
    expect(WorldRuleSchema.safeParse({ category: "magic", rule: "limits", boundary: "no resurrection" }).success).toBe(true);
    expect(StoryCompassSchema.safeParse({ ending_direction: "sacrifice", open_threads: [], estimated_scale: "3 volumes", last_updated: 1 }).success).toBe(true);
  });
  it("rejects invalid values", () => {
    expect(NovelSchema.safeParse({ name: "Test" }).success).toBe(false);
    expect(NovelSchema.safeParse({ name: "Test", total_chapters: -1 }).success).toBe(false);
    expect(OutlineEntrySchema.safeParse({ chapter: 0, title: "", core_event: "", hook: "", scenes: [] }).success).toBe(false);
    expect(ArcOutlineSchema.safeParse({ index: 1, title: "A", goal: "G", estimated_chapters: -1, chapters: [] }).success).toBe(false);
  });
});
