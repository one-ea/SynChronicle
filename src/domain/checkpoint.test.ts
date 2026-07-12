import { describe, it, expect } from "vitest";
import { CheckpointSchema, ScopeKind } from "./checkpoint.js";
describe("checkpoint persistence", () => {
  it("accepts scope kinds", () => { for (const value of ["chapter", "arc", "volume", "global"]) expect(ScopeKind.safeParse(value).success).toBe(true); });
  it("parses exact Go json tags", () => { expect(CheckpointSchema.safeParse({ seq: 42, scope: { kind: "chapter", chapter: 3 }, step: "draft_chapter", artifact: "chapter.md", digest: "abc", occurred_at: "now" }).success).toBe(true); });
  it("rejects negative seq", () => { expect(CheckpointSchema.safeParse({ seq: -1, scope: { kind: "global" }, step: "test", occurred_at: "now" }).success).toBe(false); });
});
