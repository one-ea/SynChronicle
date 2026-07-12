import { describe, it, expect } from "vitest";
import { ChapterPlanSchema, CommitResultSchema, WritingStyleRulesSchema, RecallItemSchema } from "./writing.js";

describe("ChapterPlanSchema", () => {
  it("parses valid plan", () => {
    const valid = {
      Chapter: 1,
      Title: "Start",
      Goal: "Intro",
      Conflict: "None",
      Hook: "A mystery",
      EmotionArc: "curious",
      Notes: "",
      Contract: {
        RequiredBeats: ["beat1"],
        ForbiddenMoves: [],
        ContinuityChecks: [],
        EvaluationFocus: [],
        EmotionTarget: "excited",
        PayoffPoints: [],
        HookGoal: "compelling",
      },
    };
    expect(ChapterPlanSchema.safeParse(valid).success).toBe(true);
  });
});

describe("CommitResultSchema", () => {
  it("parses with null Feedback", () => {
    const valid = {
      Chapter: 1,
      Committed: true,
      WordCount: 2500,
      NextChapter: 2,
      ReviewRequired: false,
      ReviewReason: "",
      HookType: "cliffhanger",
      DominantStrand: "main",
      Feedback: null,
      ArcEnd: false,
      VolumeEnd: false,
      Volume: 1,
      Arc: 1,
      NeedsExpansion: false,
      NeedsNewVolume: false,
      NextVolume: 1,
      NextArc: 1,
      BookComplete: false,
      Flow: "writing",
    };
    expect(CommitResultSchema.safeParse(valid).success).toBe(true);
  });
});

describe("WritingStyleRulesSchema", () => {
  it("parses valid rules", () => {
    const valid = {
      Volume: 1,
      Arc: 1,
      Prose: ["vivid"],
      Dialogue: [{ Name: "Alice", Rules: ["witty"] }],
      Taboos: ["info-dump"],
      UpdatedAt: "now",
    };
    expect(WritingStyleRulesSchema.safeParse(valid).success).toBe(true);
  });
});

describe("RecallItemSchema", () => {
  it("parses valid recall", () => {
    const valid = { Kind: "character", Key: "Alice", Chapter: 3, Reason: "reappears", Summary: "Alice returns" };
    expect(RecallItemSchema.safeParse(valid).success).toBe(true);
  });
});