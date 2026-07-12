import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { buildSnapshot, check, lint, normalizeRule, rawFileSources, systemDefaults } from "./index.js";

describe("rules", () => {
  it("loads markdown in deterministic source order", () => {
    const root = mkdtempSync(join(tmpdir(), "rules-"));
    const global = join(root, "g"); const project = join(root, "p");
    mkdirSync(global); mkdirSync(project);
    writeFileSync(join(global, "b.md"), "B"); writeFileSync(join(global, "a.md"), "A");
    writeFileSync(join(global, ".hidden.md"), "H"); writeFileSync(join(project, "z.md"), "Z");
    expect(rawFileSources({ homeRulesDir: global, projectRulesDir: project }).map(x => x.label)).toEqual(["global:a.md", "global:b.md", "project:z.md"]);
  });

  it("normalizes with retries and degrades without network", async () => {
    const generate = vi.fn().mockResolvedValueOnce("bad").mockResolvedValueOnce('```json\n{"structured":{"chapter_words":{"min":3000,"max":5000}},"preferences":"克制","uncertain":[]}\n```');
    const candidate = await normalizeRule("project:x.md", "每章三千到五千字", generate);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(candidate.structured.chapterWords).toEqual({ min: 3000, max: 5000 });
    expect((await normalizeRule("x", "raw", undefined)).degraded).toBe(true);
  });

  it("merges and mechanically checks facts", () => {
    const snapshot = buildSnapshot([systemDefaults(), { source: "project", structured: { forbiddenPhrases: ["禁句"], fatigueWords: { 仿佛: 1 } }, preferences: "偏好", uncertain: [], degraded: false }]);
    expect(check("禁句，仿佛仿佛", -1, snapshot.structured).map(x => x.rule)).toEqual(expect.arrayContaining(["forbidden_phrases", "fatigue_words", "chapter_words"]));
    expect(lint("# 标题\n## 残留\nhello **x**").map(x => x.rule)).toEqual(expect.arrayContaining(["markdown_residue", "non_cjk_fragments"]));
  });
});
