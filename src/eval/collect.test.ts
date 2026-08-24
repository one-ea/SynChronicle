import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collect } from "./collect.js";
import { Store } from "../store/index.js";

async function makeDir(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "collect-"));
  const store = new Store(dir);
  await store.init();
  await store.progress.save({ novel_name: "B", phase: "writing", current_chapter: 3, total_chapters: 10, completed_chapters: [1, 2], total_word_count: 2000, flow: "writing", in_progress_chapter: 0 });
  await store.checkpoints.append({ kind: "chapter", chapter: 1 }, "plan");
  await store.checkpoints.append({ kind: "chapter", chapter: 1 }, "commit", "chapters/01.md");
  await store.checkpoints.append({ kind: "global" }, "outline", "outline.json");
  await store.drafts.saveFinalChapter(1, "# 第一章\n\n正文一");
  await store.drafts.saveFinalChapter(2, "# 第二章\n\n正文二");
  await store.summaries.saveSummary({ chapter: 1, summary: "s1", characters: [], key_events: [] });
  await store.summaries.saveSummary({ chapter: 2, summary: "s2", characters: [], key_events: [] });
  await store.summaries.saveArcSummary({ volume: 1, arc: 1, title: "a", summary: "arc", key_events: [] });
  await store.summaries.saveVolumeSummary({ volume: 1, title: "v", summary: "vol", key_events: [] });
  await store.writeArtifact("reviews/01.json", { chapter: 1, scope: "chapter", issues: [], verdict: "accept", summary: "ok" });
  await store.usage.save({ schema: 1, updated_at: new Date().toISOString(), overall: { input: 100, output: 50, cache_read: 10, cache_write: 0, cost_usd: 0.25, saved_usd: 0, cache_capable: false }, per_agent: {}, missing_assistant_usage: 0 });
  mkdirSync(join(dir, "meta", "sessions", "agents"), { recursive: true });
  writeFileSync(join(dir, "meta", "sessions", "agents", "writer-ch01.jsonl"), [
    JSON.stringify({ role: "assistant", content: [{ type: "text", text: "thinking" }] }),
    JSON.stringify({ role: "assistant", content: [{ type: "tool-call", toolCall: { name: "plan_chapter", args: {} } }, { type: "tool-call", toolCall: { name: "draft_chapter", args: {} } }] }),
    "corrupted line",
  ].join("\n") + "\n");
  await store.signals.savePendingCommit({ chapter: 1 });
  return dir;
}

describe("collect", () => {
  it("collects stats, checkpoints, usage, tool calls and pending signals", async () => {
    const result = await collect(await makeDir());
    expect(result.stats.completedChapters).toBe(2);
    expect(result.stats.phase).toBe("writing");
    expect(result.stats.totalWords).toBe(2000);
    expect(result.stats.costUsd).toBeCloseTo(0.25);
    expect(result.stats.inputTokens).toBe(100);
    expect(result.stats.toolCalls).toBe(2);
    expect(result.stats.chapterSummaries).toBe(2);
    expect(result.stats.arcSummaries).toBe(1);
    expect(result.stats.volumeSummaries).toBe(1);
    expect(result.stats.reviews).toBe(1);
    expect(result.checkpoints).toEqual(expect.arrayContaining(["chapter:1:plan", "chapter:1:commit", "global:outline"]));
    expect(result.pending.pending_commit).toBe(true);
    expect(result.pending.in_progress).toBe(false);
    expect(result.stylestat).toBeNull();
    expect(result.loadErrors).toEqual([]);
  });

  it("reports nothing for an empty dir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collect-empty-"));
    const result = await collect(dir);
    expect(result.stats.completedChapters).toBe(0);
    expect(result.loadErrors).toEqual([]);
  });
});
