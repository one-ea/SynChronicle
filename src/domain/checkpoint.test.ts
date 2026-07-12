import { describe, it, expect } from "vitest";
import { CheckpointSchema, ScopeKind } from "./checkpoint.js";

describe("ScopeKind", () => {
  it("accepts all valid kinds", () => {
    expect(ScopeKind.safeParse("chapter").success).toBe(true);
    expect(ScopeKind.safeParse("arc").success).toBe(true);
    expect(ScopeKind.safeParse("volume").success).toBe(true);
    expect(ScopeKind.safeParse("global").success).toBe(true);
  });
});

describe("CheckpointSchema", () => {
  it("parses valid checkpoint", () => {
    const valid = {
      Seq: 42,
      Scope: { Kind: "chapter" as const, Chapter: 3, Volume: 1, Arc: 1 },
      Step: "draft_chapter",
      Artifact: "chapter_3_draft.md",
      Digest: "abc123",
      OccurredAt: "2024-06-15T10:30:00Z",
    };
    expect(CheckpointSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects negative Seq", () => {
    const valid = {
      Seq: -1,
      Scope: { Kind: "chapter" as const, Chapter: 1, Volume: 1, Arc: 1 },
      Step: "test",
      Artifact: "test",
      Digest: "abc",
      OccurredAt: "now",
    };
    expect(CheckpointSchema.safeParse(valid).success).toBe(false);
  });
});