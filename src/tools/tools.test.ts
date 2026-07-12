import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "../store/index.js";
import { createToolRegistry } from "./registry.js";

let store: Store;

beforeEach(async () => {
  store = new Store(await mkdtemp(join(tmpdir(), "synchronicle-tools-")));
  await store.init();
  await store.progress.init("test", 3);
});

describe("tools registry", () => {
  it("registers the complete Go tool set and read_draft alias", () => {
    const tools = createToolRegistry({ store });
    expect(Object.keys(tools)).toEqual(expect.arrayContaining([
      "novel_context", "save_foundation", "plan_chapter", "draft_chapter",
      "edit_chapter", "check_consistency", "commit_chapter", "read_chapter",
      "read_draft", "save_review", "save_arc_summary", "save_volume_summary",
      "save_pause_point", "save_user_rules", "ask_user", "reopen_book",
    ]));
    expect(tools.read_draft).toBe(tools.read_chapter);
  });

  it("validates arguments with Zod before execution", async () => {
    const tools = createToolRegistry({ store });
    expect(() => tools.draft_chapter.inputSchema.parse({ chapter: 0, content: "", mode: "bad" })).toThrow();
  });
});

describe("write tools", () => {
  it("writes a draft before appending its checkpoint", async () => {
    const order: string[] = [];
    vi.spyOn(store.drafts, "saveDraft").mockImplementation(async () => { order.push("write"); });
    vi.spyOn(store.checkpoints, "appendArtifact").mockImplementation(async () => {
      order.push("checkpoint");
      return {} as never;
    });
    const tool = createToolRegistry({ store }).draft_chapter;
    await tool.execute!({ chapter: 1, content: "正文", mode: "write" }, {} as never);
    expect(order).toEqual(["write", "checkpoint"]);
  });

  it("plans a chapter and appends a plan checkpoint", async () => {
    const tool = createToolRegistry({ store }).plan_chapter;
    await tool.execute!({ chapter: 1, title: "开篇", goal: "推进", conflict: "阻力", hook: "悬念" }, {} as never);
    expect(await store.drafts.loadChapterPlan(1)).toMatchObject({ chapter: 1, title: "开篇" });
    expect(await store.checkpoints.latestByStep({ kind: "chapter", chapter: 1 }, "plan")).not.toBeNull();
  });

  it("edits a unique draft match and appends checkpoint", async () => {
    await store.drafts.saveDraft(1, "他握紧拳头，指节发白。");
    const tool = createToolRegistry({ store }).edit_chapter;
    await tool.execute!({ chapter: 1, old_string: "指节发白", new_string: "指节泛青", replace_all: false }, {} as never);
    expect(await store.drafts.loadDraft(1)).toContain("指节泛青");
    expect(await store.checkpoints.latestByStep({ kind: "chapter", chapter: 1 }, "edit")).not.toBeNull();
  });

  it("commits draft, summary and progress before checkpoint", async () => {
    await store.drafts.saveDraft(1, "第一章正文。");
    const tool = createToolRegistry({ store }).commit_chapter;
    await tool.execute!({ chapter: 1, summary: "开篇", characters: ["林砚"], key_events: ["出发"] }, {} as never);
    expect(await store.drafts.loadChapterText(1)).toBe("第一章正文。");
    expect((await store.progress.load())?.completed_chapters).toContain(1);
    expect(await store.checkpoints.latestByStep({ kind: "chapter", chapter: 1 }, "commit")).not.toBeNull();
  });

  it("reopens a completed book and appends global checkpoint", async () => {
    await store.progress.markChapterComplete(1, 10, "", "");
    await store.progress.markComplete();
    const tool = createToolRegistry({ store }).reopen_book;
    await tool.execute!({ chapters: [1], reason: "返工" }, {} as never);
    expect(await store.progress.load()).toMatchObject({ phase: "writing", flow: "rewriting", pending_rewrites: [1] });
    expect(await store.checkpoints.latestByStep({ kind: "global" }, "reopen")).not.toBeNull();
  });

  it("saves foundation before its checkpoint", async () => {
    const tool = createToolRegistry({ store }).save_foundation;
    await tool.execute({ type: "premise", content: "# 长夜燃灯", scale: "long" });
    expect(await store.outline.loadPremise()).toBe("# 长夜燃灯");
    expect((await store.progress.load())?.novel_name).toBe("长夜燃灯");
    expect(await store.checkpoints.latestByStep({ kind: "global" }, "premise")).not.toBeNull();
  });

  it("supports Go foundation expansion and volume append operations", async () => {
    const tool = createToolRegistry({ store }).save_foundation;
    await tool.execute({ type: "layered_outline", content: [{ index: 1, title: "卷一", theme: "起", arcs: [{ index: 1, title: "弧一", goal: "推进", chapters: [] }] }], scale: "long" });
    await tool.execute({ type: "expand_arc", volume: 1, arc: 1, content: [{ chapter: 1, title: "开篇", core_event: "出发", hook: "追兵", scenes: [] }] });
    await tool.execute({ type: "append_volume", content: { index: 2, title: "卷二", theme: "承", arcs: [] } });
    const volumes = await store.outline.loadLayeredOutline();
    expect(volumes[0]?.arcs[0]?.chapters).toHaveLength(1);
    expect(volumes[1]?.index).toBe(2);
  });

  it("saves arc and volume summaries with scoped checkpoints", async () => {
    const tools = createToolRegistry({ store });
    await tools.save_arc_summary.execute({ volume: 1, arc: 2, title: "入山", summary: "完成试炼", key_events: ["通过"], character_snapshots: [] });
    await tools.save_volume_summary.execute({ volume: 1, title: "第一卷", summary: "卷摘要", key_events: ["入山"] });
    expect(await store.summaries.loadArcSummary(1, 2)).toMatchObject({ title: "入山" });
    expect(await store.checkpoints.latestByStep({ kind: "arc", volume: 1, arc: 2 }, "arc_summary")).not.toBeNull();
    expect(await store.checkpoints.latestByStep({ kind: "volume", volume: 1 }, "volume_summary")).not.toBeNull();
  });

  it("derives review verdict, updates rewrite state, then checkpoints", async () => {
    await store.progress.markChapterComplete(1, 10, "", "");
    const dimensions = (["consistency", "character", "pacing", "continuity", "foreshadow", "hook", "aesthetic"] as const).map((dimension) => ({ dimension, score: dimension === "pacing" ? 55 : 85, comment: "有事实依据" }));
    const tool = createToolRegistry({ store }).save_review;
    const result = await tool.execute({ chapter: 1, scope: "chapter", dimensions, issues: [], verdict: "accept", summary: "节奏需重写" }) as Record<string, unknown>;
    expect(result.final_verdict).toBe("rewrite");
    expect(await store.progress.load()).toMatchObject({ flow: "rewriting", pending_rewrites: [1] });
    expect(await store.checkpoints.latestByStep({ kind: "chapter", chapter: 1 }, "review")).not.toBeNull();
  });

  it("sets and idempotently clears a pause point", async () => {
    await store.progress.updatePhase("writing");
    const tool = createToolRegistry({ store }).save_pause_point;
    await tool.execute({ after: "rewrites_drained", reason: "验收", cancel: false });
    expect((await store.runMeta.load() as { pause_point?: unknown })?.pause_point).toBeTruthy();
    await expect(tool.execute({ reason: "", cancel: true })).resolves.toMatchObject({ pause_point_cleared: true });
  });
});

describe("read and interaction tools", () => {
  it("reads final chapter with draft fallback", async () => {
    await store.drafts.saveDraft(2, "草稿正文");
    const tool = createToolRegistry({ store }).read_chapter;
    await expect(tool.execute!({ chapter: 2, source: "final" }, {} as never)).resolves.toMatchObject({ content: "草稿正文" });
  });

  it("formats ask_user responses", async () => {
    const tool = createToolRegistry({ store, askUser: async () => ({ answers: { "篇幅？": "长篇" }, notes: {} }) }).ask_user;
    await expect(tool.execute!({ questions: [{ question: "篇幅？", header: "篇幅", options: [{ label: "长篇", description: "长线" }, { label: "短篇", description: "单卷" }], multiSelect: false }] }, {} as never)).resolves.toBe("用户回答：[篇幅] 长篇");
  });
});
