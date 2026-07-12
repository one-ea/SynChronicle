import { describe, it, expect } from "vitest";
import { UsageStateSchema } from "./usage.js";
import { CastEntrySchema } from "./cast.js";
import { ReviewEntrySchema } from "./review.js";
import { SimulationProfileSchema, SimulationCompactProfileSchema } from "./simulation.js";
import { RuntimeQueueItemSchema, RuntimeQueuePriority, RuntimeQueueKind } from "./runtimeEvents.js";

describe("UsageStateSchema", () => {
  it("parses valid usage", () => {
    const totals = { Input: 1000, Output: 500, CacheRead: 0, CacheWrite: 0, Cost: 0.01, Saved: 0, CacheCapable: false, CacheBreaks: 0 };
    const valid = { Schema: 1, UpdatedAt: "now", Overall: totals, PerAgent: {}, PerModel: {}, MissingUsage: 0 };
    expect(UsageStateSchema.safeParse(valid).success).toBe(true);
  });
});

describe("CastEntrySchema", () => {
  it("parses valid cast entry", () => {
    const valid = {
      Name: "Alice",
      Aliases: [],
      BriefRole: "Hero",
      FirstSeenChapter: 1,
      LastSeenChapter: 10,
      AppearanceCount: 5,
      AppearanceChapters: [1, 3, 5, 7, 10],
      Promoted: true,
    };
    expect(CastEntrySchema.safeParse(valid).success).toBe(true);
  });
});

describe("ReviewEntrySchema", () => {
  it("parses valid review", () => {
    const valid = {
      Chapter: 1,
      Scope: "arc",
      Issues: [],
      Dimensions: [{ Dimension: "pacing", Score: 8, Verdict: "good", Comment: "well paced" }],
      ContractStatus: "met",
      ContractMisses: [],
      ContractNotes: "",
      Verdict: "pass",
      Summary: "Good chapter",
      AffectedChapters: [],
    };
    expect(ReviewEntrySchema.safeParse(valid).success).toBe(true);
  });
});

describe("SimulationProfileSchema", () => {
  it("parses minimal profile", () => {
    const valid = {
      Version: "1",
      CreatedAt: "now",
      UpdatedAt: "now",
      Corpus: { SourceDir: "/tmp", Sources: [] },
      SourceReports: [],
      Synthesis: buildMinimalSynthesis(),
    };
    expect(SimulationProfileSchema.safeParse(valid).success).toBe(true);
  });
});

describe("SimulationCompactProfileSchema", () => {
  it("parses compact profile", () => {
    const valid = {
      Version: "1",
      UpdatedAt: "now",
      SourceCount: 0,
      SourceFiles: [],
      ...buildMinimalProfileFields(),
    };
    expect(SimulationCompactProfileSchema.safeParse(valid).success).toBe(true);
  });
});

describe("RuntimeQueueItemSchema", () => {
  it("parses valid item", () => {
    const valid = {
      Seq: 1,
      Time: "now",
      Kind: "ui_event" as const,
      Priority: "control" as const,
      TaskID: "t1",
      Agent: "coordinator",
      Category: "DISPATCH",
      Summary: "test",
      Payload: {},
    };
    expect(RuntimeQueueItemSchema.safeParse(valid).success).toBe(true);
  });
});

describe("RuntimeQueuePriority", () => {
  it("accepts valid priorities", () => {
    expect(RuntimeQueuePriority.safeParse("control").success).toBe(true);
    expect(RuntimeQueuePriority.safeParse("background").success).toBe(true);
  });
});

describe("RuntimeQueueKind", () => {
  it("accepts all valid kinds", () => {
    expect(RuntimeQueueKind.safeParse("ui_event").success).toBe(true);
    expect(RuntimeQueueKind.safeParse("stream_delta").success).toBe(true);
    expect(RuntimeQueueKind.safeParse("stream_clear").success).toBe(true);
    expect(RuntimeQueueKind.safeParse("control").success).toBe(true);
  });
});

function buildMinimalSynthesis() {
  return {
    Style: buildEmptyStyle(),
    Lexicon: buildEmptyLexicon(),
    PlotDesign: buildEmptyPlotDesign(),
    HookDesign: buildEmptyHookDesign(),
    PacingDensity: buildEmptyPacingDensity(),
    ReaderEngagement: buildEmptyReaderEngagement(),
    RoleGuidance: buildEmptyRoleGuidance(),
  };
}

function buildMinimalProfileFields() {
  return {
    Style: buildEmptyStyle(),
    Lexicon: buildEmptyLexicon(),
    PlotDesign: buildEmptyPlotDesign(),
    HookDesign: buildEmptyHookDesign(),
    PacingDensity: buildEmptyPacingDensity(),
    ReaderEngagement: buildEmptyReaderEngagement(),
    RoleGuidance: buildEmptyRoleGuidance(),
  };
}

function buildEmptyStyle() {
  return { NarrativeVoice: [], SentenceRhythm: [], ProseTexture: [], Perspective: [], Mood: [], DoNotCopy: [] };
}

function buildEmptyLexicon() {
  return { CommonWords: [], EmotionWords: [], SceneWords: [], TransitionWords: [], SignaturePhrases: [] };
}

function buildEmptyPlotDesign() {
  return { OpeningPatterns: [], EscalationPatterns: [], TurningPointPatterns: [], PayoffPatterns: [] };
}

function buildEmptyHookDesign() {
  return { HookTypes: [], Placement: [], CliffhangerPatterns: [], PayoffRules: [] };
}

function buildEmptyPacingDensity() {
  return { SceneDensity: [], InformationRelease: [], DialogueActionRatio: [], CompressionRules: [] };
}

function buildEmptyReaderEngagement() {
  return { Methods: [], EmotionalDrivers: [], ProgressionRewards: [], AntiPatterns: [] };
}

function buildEmptyRoleGuidance() {
  return { Coordinator: [], Architect: [], Writer: [], Editor: [] };
}