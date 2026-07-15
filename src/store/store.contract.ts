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
}
