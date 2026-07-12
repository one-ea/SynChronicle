import { describe, it, expect } from "vitest";
import { ProgressSchema, Phase, FlowState, PlanningTier, RunMetaSchema, MemoryPolicySchema, ContextProfileSchema, PausePointSchema } from "./runtime.js";

describe("Phase", () => {
  it("accepts all valid phases", () => {
    expect(Phase.safeParse("init").success).toBe(true);
    expect(Phase.safeParse("premise").success).toBe(true);
    expect(Phase.safeParse("outline").success).toBe(true);
    expect(Phase.safeParse("writing").success).toBe(true);
    expect(Phase.safeParse("complete").success).toBe(true);
  });

  it("rejects invalid phase", () => {
    expect(Phase.safeParse("unknown").success).toBe(false);
  });
});

describe("FlowState", () => {
  it("accepts all valid states", () => {
    expect(FlowState.safeParse("writing").success).toBe(true);
    expect(FlowState.safeParse("reviewing").success).toBe(true);
    expect(FlowState.safeParse("rewriting").success).toBe(true);
    expect(FlowState.safeParse("polishing").success).toBe(true);
    expect(FlowState.safeParse("steering").success).toBe(true);
  });
});

describe("PlanningTier", () => {
  it("accepts all valid tiers", () => {
    expect(PlanningTier.safeParse("short").success).toBe(true);
    expect(PlanningTier.safeParse("mid").success).toBe(true);
    expect(PlanningTier.safeParse("long").success).toBe(true);
  });
});

describe("ProgressSchema", () => {
  const valid = {
    NovelName: "Test",
    Phase: "writing" as const,
    CurrentChapter: 3,
    TotalChapters: 10,
    CompletedChapters: [1, 2],
    TotalWordCount: 5000,
    ChapterWordCounts: { "1": 2500, "2": 2500 },
    InProgressChapter: 3,
    CompletedScenes: [1, 2, 3],
    Flow: "writing" as const,
    PendingRewrites: [],
    RewriteReason: "",
    StrandHistory: [],
    HookHistory: [],
    CurrentVolume: 1,
    CurrentArc: 1,
    Layered: false,
    ReopenedFromComplete: false,
  };

  it("parses valid progress", () => {
    expect(ProgressSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects invalid phase", () => {
    expect(ProgressSchema.safeParse({ ...valid, Phase: "invalid" }).success).toBe(false);
  });

  it("rejects negative word count", () => {
    expect(ProgressSchema.safeParse({ ...valid, TotalWordCount: -1 }).success).toBe(false);
  });
});

describe("RunMetaSchema", () => {
  it("parses with null PausePoint", () => {
    const valid = {
      StartedAt: "2024-01-01T00:00:00Z",
      Provider: "openai",
      Style: "default",
      Model: "gpt-4",
      PlanningTier: "mid",
      SteerHistory: [],
      PendingSteer: "",
      PausePoint: null,
    };
    expect(RunMetaSchema.safeParse(valid).success).toBe(true);
  });

  it("parses with PausePoint", () => {
    const valid = {
      StartedAt: "2024-01-01T00:00:00Z",
      Provider: "openai",
      Style: "default",
      Model: "gpt-4",
      PlanningTier: "mid",
      SteerHistory: [],
      PendingSteer: "",
      PausePoint: { After: "chapter", Reason: "review needed", SetAt: "2024-01-02T00:00:00Z" },
    };
    expect(RunMetaSchema.safeParse(valid).success).toBe(true);
  });
});

describe("MemoryPolicySchema", () => {
  it("parses valid policy", () => {
    const valid = {
      Mode: "adaptive",
      SummaryWindow: 10,
      TimelineWindow: 20,
      LayeredSummaries: true,
      SummaryStrategy: "rolling",
      WorkingRefresh: "per-turn",
      EpisodicRefresh: "per-arc",
      PlanningRefresh: "per-volume",
      FoundationRefresh: "never",
      PlanningFocus: "current",
      FoundationFocus: "all",
      PreviousTailChars: 2000,
      ChapterPlanEnabled: true,
      RelatedLookup: true,
      CurrentOutlineBound: true,
      TotalChapters: 10,
      HandoffPreferred: false,
      ReadOnlyThreshold: 5,
    };
    expect(MemoryPolicySchema.safeParse(valid).success).toBe(true);
  });
});

describe("ContextProfileSchema", () => {
  it("parses valid profile", () => {
    const valid = { SummaryWindow: 5, TimelineWindow: 10, Layered: true };
    expect(ContextProfileSchema.safeParse(valid).success).toBe(true);
  });
});

describe("PausePointSchema", () => {
  it("parses valid pause point", () => {
    const valid = { After: "chapter", Reason: "review", SetAt: "now" };
    expect(PausePointSchema.safeParse(valid).success).toBe(true);
  });
});