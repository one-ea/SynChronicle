import { describe, expect, it } from "vitest";
import { projectValue, redactMessage, renderExport } from "./index.js";

describe("diag", () => {
  it("keeps structural values and redacts prose", () => {
    expect(projectValue('"7"')).toBe('"7"');
    expect(projectValue('"writer"')).toBe('"writer"');
    expect(projectValue('"雪夜里的秘密"')).toMatch(/^<redacted/);
    const event = redactMessage("coordinator", { role: "assistant", content: [{ type: "text", text: "机密正文" }, { type: "tool-call", toolCall: { name: "commit_chapter", args: { chapter: "7", content: "机密正文" } } }] });
    const output = renderExport({ stats: { completedChapters: 0, totalChapters: 0, totalWords: 0, phase: "", flow: "" }, findings: [] }, { platform: "linux/x64", tail: [event], redactedTexts: 1, sources: [] });
    expect(output).not.toContain("机密正文");
    expect(output).toContain('chapter: "7"');
  });
});
