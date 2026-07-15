import { expect, it } from "vitest";
import type { StorePort } from "./port.js";

export function storeContract(createStore: () => Promise<StorePort>): void {
  it("round-trips outline, chapter, checkpoint, usage, and runtime events", async () => {
    const store = await createStore();
    await store.outline.savePremise("premise");
    await store.drafts.saveFinalChapter(1, "chapter");
    await store.checkpoints.append({ kind: "global" }, "saved", "premise.md", "sha256:test");
    await store.usage.save({ schema: 1, updated_at: "now", overall: { input: 1, output: 2, cache_read: 0, cache_write: 0, cost_usd: 0.1, saved_usd: 0, cache_capable: false }, per_agent: {}, missing_assistant_usage: 0 });
    await store.runtime.appendQueue({ seq: 0, time: "", kind: "ui_event", priority: "background", summary: "saved" });

    expect(await store.outline.loadPremise()).toBe("premise");
    expect(await store.drafts.loadChapterText(1)).toBe("chapter");
    expect((await store.checkpoints.latestGlobal())?.step).toBe("saved");
    expect((await store.usage.load())?.overall.output).toBe(2);
    expect(await store.runtime.loadQueue()).toHaveLength(1);
  });

  it("updates text and JSON artifacts and serializes runtime sequence", async () => {
    const store = await createStore();
    await store.outline.savePremise("first");
    await store.outline.savePremise("second");
    await store.drafts.saveFinalChapter(1, "first chapter");
    await store.drafts.saveFinalChapter(1, "second chapter");
    const runMeta = { started_at: "now", provider: "test", style: "", model: "test", planning_tier: "short" as const, steer_history: [], pending_steer: "first", pause_point: null };
    await store.runMeta.save(runMeta);
    await store.runMeta.save({ ...runMeta, pending_steer: "second" });
    await Promise.all([1, 2, 3].map((value) => store.runtime.appendQueue({ seq: 0, time: "", kind: "ui_event", priority: "background", summary: String(value) })));
    await store.checkpoints.append({ kind: "global" }, "one");
    await store.checkpoints.reload();
    expect(await store.outline.loadPremise()).toBe("second");
    expect(await store.drafts.loadChapterText(1)).toBe("second chapter");
    expect(await store.runMeta.load()).toMatchObject({ pending_steer: "second" });
    expect((await store.runtime.loadQueue()).map((item) => item.seq)).toEqual([1, 2, 3]);
    expect((await store.checkpoints.latestGlobal())?.step).toBe("one");
  });

  it("keeps recording candidates invisible until selected", async () => {
    const store = await createStore();
    await store.outline.savePremise("baseline");
    const transaction = store.recordingTransaction();
    await transaction.store.outline.savePremise("candidate");
    const staging = await store.staging.createSession(`contract-${Math.random()}`);
    const ids = await transaction.stage(staging, 1);
    expect(await store.outline.loadPremise()).toBe("baseline");
    await store.commitStaged(staging, ids);
    expect(await store.outline.loadPremise()).toBe("candidate");
  });

  it("keeps every candidate invisible when commit validation fails", async () => {
    const store = await createStore();
    await store.outline.savePremise("baseline");
    const transaction = store.recordingTransaction();
    await transaction.store.outline.savePremise("candidate");
    const staging = await store.staging.createSession(`contract-rollback-${Math.random()}`);
    const ids = await transaction.stage(staging, 1);
    await expect(store.commitStaged(staging, [...ids, "unknown-candidate"])).rejects.toThrow("未知候选 ID");
    expect(await store.outline.loadPremise()).toBe("baseline");
  });

  it("resets runtime events and checkpoints", async () => {
    const store = await createStore();
    await store.runtime.appendQueue({ seq: 0, time: "", kind: "ui_event", priority: "background", summary: "event" });
    await store.checkpoints.append({ kind: "global" }, "checkpoint");
    await store.runtime.reset();
    await store.checkpoints.reset();
    expect(await store.runtime.loadQueue()).toEqual([]);
    expect(await store.checkpoints.all()).toEqual([]);
  });

  it("completes structured steer delivery without clearing newer commands", async () => {
    const store = await createStore();
    const fallback = { started_at: "now", provider: "test", style: "", model: "test", planning_tier: "mid" as const, steer_history: [], pending_steer: "", pause_point: null };
    await store.progress.save({ novel_name: "Book", phase: "writing", current_chapter: 1, total_chapters: 2, completed_chapters: [], total_word_count: 0, flow: "steering" });
    await store.applySteerCommand("steer-a", "Direction A", fallback);
    await store.applySteerCommand("steer-b", "Direction B", fallback);

    await store.completeSteerDelivery(["steer-a"]);
    expect(await store.pendingSteerCommands()).toEqual([{ id: "steer-b", instruction: "Direction B" }]);
    expect(await store.runMeta.load()).toMatchObject({ pending_steer: "Direction B" });
    expect(await store.progress.load()).toMatchObject({ flow: "steering" });

    await store.completeSteerDelivery(["steer-b"]);
    expect(await store.pendingSteerCommands()).toEqual([]);
    expect(await store.runMeta.load()).toMatchObject({ pending_steer: "" });
    expect(await store.progress.load()).toMatchObject({ flow: "writing" });
  });
}
