import { describe, it, expect } from "vitest";
import { ProgressSchema, Phase, FlowState, PlanningTier, RunMetaSchema, MemoryPolicySchema, ContextProfileSchema, PausePointSchema } from "./runtime.js";
describe("runtime enums", () => {
  it("accepts valid values", () => { for (const value of ["init", "premise", "outline", "writing", "complete"]) expect(Phase.safeParse(value).success).toBe(true); for (const value of ["writing", "reviewing", "rewriting", "polishing", "steering"]) expect(FlowState.safeParse(value).success).toBe(true); for (const value of ["short", "mid", "long"]) expect(PlanningTier.safeParse(value).success).toBe(true); });
});
describe("runtime persistence schemas", () => {
  const progress = { novel_name: "Test", phase: "writing", current_chapter: 3, total_chapters: 10, completed_chapters: [1, 2], total_word_count: 5000, chapter_word_counts: { "1": 2500 }, flow: "writing" };
  it("parses exact Go json tags", () => {
    expect(ProgressSchema.safeParse(progress).success).toBe(true);
    expect(RunMetaSchema.safeParse({ started_at: "now", provider: "openai", style: "default", model: "gpt", planning_tier: "mid", steer_history: [], pending_steer: "", pause_point: null }).success).toBe(true);
    expect(RunMetaSchema.safeParse({ started_at: "now", provider: "openai", style: "default", model: "gpt", planning_tier: "mid", steer_history: [], pending_steer: "", pause_point: { after: "chapter", reason: "review", set_at: "now" } }).success).toBe(true);
    expect(MemoryPolicySchema.safeParse({ mode: "adaptive", summary_window: 10, related_chapter_lookup: true }).success).toBe(true);
    expect(ContextProfileSchema.safeParse({ summary_window: 5, timeline_window: 10, layered: true }).success).toBe(true);
    expect(PausePointSchema.safeParse({ after: "chapter", reason: "review", set_at: "now" }).success).toBe(true);
  });
  it("rejects invalid values", () => { expect(ProgressSchema.safeParse({ ...progress, phase: "invalid" }).success).toBe(false); expect(ProgressSchema.safeParse({ ...progress, total_word_count: -1 }).success).toBe(false); });
});
