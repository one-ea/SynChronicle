import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../store/index.js";
import { projectValue, redactMessage, renderExport, diagnose, type DiagReport } from "./index.js";

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

  describe("diagnose", () => {
    async function makeStore(completed: number[], overrides: { flow?: "writing" | "reviewing" | "rewriting" | "polishing" | "steering"; inProgress?: number; outlineChapters?: number; compassUpdated?: number; layered?: boolean } = {}) {
      const dir = mkdtempSync(join(tmpdir(), "diag-"));
      mkdirSync(join(dir, "chapters"), { recursive: true });
      const store = new Store(dir);
      await store.init();
      for (const chapter of completed) {
        await store.drafts.saveFinalChapter(chapter, `# 第 ${chapter} 章\n\n正文${chapter}`);
        await store.summaries.saveSummary({ chapter, summary: `摘要${chapter}`, characters: [], key_events: [] });
        await store.checkpoints.append({ kind: "chapter", chapter }, "plan", `drafts/${String(chapter).padStart(2, "0")}.plan.json`);
        await store.checkpoints.append({ kind: "chapter", chapter }, "commit", `chapters/${String(chapter).padStart(2, "0")}.md`);
      }
      const outlineChapters = overrides.outlineChapters ?? Math.max(3, completed.length + 2);
      await store.outline.saveOutline(Array.from({ length: outlineChapters }, (_, index) => ({ chapter: index + 1, title: `第${index + 1}章`, core_event: `事件${index + 1}`, hook: `钩子${index + 1}`, scenes: [] })));
      await store.outline.savePremise("# 测试小说\n\n一句前提。");
      await store.characters.save([{ name: "主角", role: "主角", description: "测试", arc: "成长", traits: [] }]);
      await store.world.saveWorldRules([{ category: "世界", rule: "规则", boundary: "边界" }]);
      await store.progress.save({
        novel_name: "T", phase: "writing", current_chapter: (completed.at(-1) ?? 0) + 1, total_chapters: outlineChapters,
        completed_chapters: completed, total_word_count: completed.length * 100,
        in_progress_chapter: overrides.inProgress ?? 0, flow: overrides.flow ?? "writing",
        ...(overrides.layered ? { layered: true } : {}),
      });
      if (overrides.compassUpdated !== undefined) {
        await store.outline.saveCompass({ ending_direction: "x", last_updated: overrides.compassUpdated });
      }
      return { dir, store };
    }

    const rules = (report: DiagReport) => report.findings.map(f => f.rule);

    it("reports nothing for a clean run", async () => {
      const { store } = await makeStore([1, 2, 3]);
      const report = await diagnose(store);
      expect(report.findings).toEqual([]);
      expect(report.stats.completedChapters).toBe(3);
      expect(report.stats.phase).toBe("writing");
    });

    it("flags missing commit checkpoint", async () => {
      const { store } = await makeStore([1]);
      await store.checkpoints.reset();
      const report = await diagnose(store);
      expect(rules(report)).toContain("CommitWithoutCheckpoint");
    });

    it("flags missing chapter text and missing summary", async () => {
      const { dir, store } = await makeStore([1, 2]);
      await store.drafts.saveFinalChapter(2, "");
      const { rmSync } = await import("node:fs");
      rmSync(join(dir, "summaries", "01.json"));
      const report = await diagnose(store);
      const found = rules(report);
      expect(found).toContain("MissingChapterText");
      expect(found).toContain("MissingChapterSummary");
    });

    it("flags duplicate commit and orphan checkpoint", async () => {
      const { store } = await makeStore([1]);
      await store.checkpoints.append({ kind: "chapter", chapter: 1 }, "commit", "chapters/01.md");
      await store.checkpoints.append({ kind: "chapter", chapter: 2 }, "commit", "chapters/02.md");
      const report = await diagnose(store);
      const found = rules(report);
      expect(found).toContain("DuplicateCommit");
      expect(found).toContain("CheckpointOrphan");
    });

    it("flags chapter gaps", async () => {
      const { store } = await makeStore([1, 2, 4]);
      const report = await diagnose(store);
      expect(rules(report)).toContain("ChapterGaps");
    });

    it("flags crash residues and stuck flows", async () => {
      const { store } = await makeStore([1], { flow: "steering", inProgress: 2 });
      await store.signals.savePendingCommit({ chapter: 1 });
      const report = await diagnose(store);
      const found = rules(report);
      expect(found).toContain("InProgressResidue");
      expect(found).toContain("PendingCommitSignal");
      expect(found).toContain("PhaseFlowMismatch");
    });

    it("flags pending steer residue", async () => {
      const { store } = await makeStore([1]);
      await store.runMeta.save({ started_at: new Date().toISOString(), provider: "p", model: "m", style: "", planning_tier: "short", steer_history: [], pending_steer: "要更暗", pause_point: null });
      const report = await diagnose(store);
      expect(rules(report)).toContain("PendingSteer");
    });

    it("flags outline exhaustion and compass drift", async () => {
      const { store } = await makeStore(Array.from({ length: 20 }, (_, index) => index + 1), { outlineChapters: 20, layered: true, compassUpdated: 1 });
      const report = await diagnose(store);
      const found = rules(report);
      expect(found).toContain("CompassDrift");
    });

    it("flags outline exhaustion for the next unwritten chapter", async () => {
      const { store } = await makeStore([1, 2, 3], { outlineChapters: 3 });
      const report = await diagnose(store);
      expect(rules(report)).toContain("OutlineExhausted");
    });

    it("flags repeated identical tool calls in coordinator session", async () => {
      const { store } = await makeStore([1]);
      const lines = Array.from({ length: 8 }, () => JSON.stringify({ role: "assistant", content: [{ type: "tool-call", toolCall: { name: "novel_context", args: {} } }] }));
      writeFileSync(join(store.dir, "meta", "sessions", "coordinator.jsonl"), `${lines.join("\n")}\n`);
      const report = await diagnose(store);
      expect(rules(report)).toContain("RepeatedToolLoop");
    });
  });
});
