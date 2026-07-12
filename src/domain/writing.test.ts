import { describe, it, expect } from "vitest";
import { ChapterPlanSchema, CommitResultSchema, WritingStyleRulesSchema, RecallItemSchema } from "./writing.js";
describe("writing persistence schemas", () => {
  it("parses chapter plan", () => { expect(ChapterPlanSchema.safeParse({ chapter: 1, title: "Start", goal: "Intro", conflict: "None", hook: "Mystery", emotion_arc: "curious", notes: "", contract: { required_beats: ["beat1"], forbidden_moves: [], continuity_checks: [], evaluation_focus: [], emotion_target: "excited", payoff_points: [], hook_goal: "compelling" } }).success).toBe(true); });
  it("parses commit result", () => { expect(CommitResultSchema.safeParse({ chapter: 1, committed: true, word_count: 2500, next_chapter: 2, review_required: false, feedback: null, flow: "writing" }).success).toBe(true); });
  it("parses style rules", () => { expect(WritingStyleRulesSchema.safeParse({ volume: 1, arc: 1, prose: ["vivid"], dialogue: [{ name: "Alice", rules: ["witty"] }], taboos: ["info-dump"], updated_at: "now" }).success).toBe(true); });
  it("parses recall item", () => { expect(RecallItemSchema.safeParse({ kind: "character", key: "Alice", chapter: 3, reason: "reappears", summary: "Alice returns" }).success).toBe(true); });
});
