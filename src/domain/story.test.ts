import { describe, it, expect } from "vitest";
import { NovelSchema, CharacterSchema, OutlineEntrySchema, VolumeOutlineSchema, ArcOutlineSchema, WorldRuleSchema, StoryCompassSchema } from "./story.js";

describe("NovelSchema", () => {
  it("parses valid novel", () => {
    const result = NovelSchema.safeParse({ Name: "Test Novel", TotalChapters: 10 });
    expect(result.success).toBe(true);
  });

  it("rejects missing fields", () => {
    const result = NovelSchema.safeParse({ Name: "Test" });
    expect(result.success).toBe(false);
  });

  it("rejects negative chapters", () => {
    const result = NovelSchema.safeParse({ Name: "Test", TotalChapters: -1 });
    expect(result.success).toBe(false);
  });
});

describe("CharacterSchema", () => {
  const valid = {
    Name: "Alice",
    Aliases: ["Ally"],
    Role: "protagonist",
    Description: "A brave hero",
    Arc: "growth",
    Traits: ["brave", "kind"],
    Tier: "S",
  };

  it("parses valid character", () => {
    expect(CharacterSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects missing Name", () => {
    const { Name: _, ...rest } = valid;
    expect(CharacterSchema.safeParse(rest).success).toBe(false);
  });
});

describe("OutlineEntrySchema", () => {
  const valid = {
    Chapter: 1,
    Title: "The Beginning",
    CoreEvent: "Hero awakens",
    Hook: "A mysterious letter",
    Scenes: ["scene 1", "scene 2"],
  };

  it("parses valid entry", () => {
    expect(OutlineEntrySchema.safeParse(valid).success).toBe(true);
  });

  it("rejects chapter 0", () => {
    expect(OutlineEntrySchema.safeParse({ ...valid, Chapter: 0 }).success).toBe(false);
  });
});

describe("VolumeOutlineSchema", () => {
  it("parses nested structure", () => {
    const valid = {
      Index: 1,
      Title: "Volume One",
      Theme: "Discovery",
      Final: false,
      Arcs: [{
        Index: 1,
        Title: "Arc One",
        Goal: "Find the key",
        EstimatedChapters: 5,
        Chapters: [{
          Chapter: 1,
          Title: "Start",
          CoreEvent: "Begin",
          Hook: "A secret",
          Scenes: [],
        }],
      }],
    };
    expect(VolumeOutlineSchema.safeParse(valid).success).toBe(true);
  });
});

describe("ArcOutlineSchema", () => {
  it("rejects negative estimated chapters", () => {
    const valid = {
      Index: 1,
      Title: "Arc One",
      Goal: "Test",
      EstimatedChapters: -1,
      Chapters: [],
    };
    expect(ArcOutlineSchema.safeParse(valid).success).toBe(false);
  });
});

describe("WorldRuleSchema", () => {
  it("parses valid world rule", () => {
    const valid = { Category: "magic", Rule: "Magic has limits", Boundary: "No resurrection" };
    expect(WorldRuleSchema.safeParse(valid).success).toBe(true);
  });
});

describe("StoryCompassSchema", () => {
  it("parses valid compass", () => {
    const valid = {
      EndingDirection: "heroic sacrifice",
      OpenThreads: ["mystery of the amulet"],
      EstimatedScale: "300 chapters",
      LastUpdated: 1234567890,
    };
    expect(StoryCompassSchema.safeParse(valid).success).toBe(true);
  });
});