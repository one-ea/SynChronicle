import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "./index.js";
import { createToolRegistry } from "../tools/registry.js";

describe("RecordingTransaction", () => {
  it("keeps writes isolated while reads include the formal baseline", async () => {
    const dir = await mkdtemp(join(tmpdir(), "synchronicle-transaction-"));
    const store = new Store(dir);
    await store.init();
    await store.drafts.saveDraft(1, "baseline");

    const transaction = store.recordingTransaction();
    expect(await transaction.store.drafts.loadDraft(1)).toBe("baseline");
    await transaction.store.drafts.saveDraft(1, "candidate");

    expect(await transaction.store.drafts.loadDraft(1)).toBe("candidate");
    expect(await store.drafts.loadDraft(1)).toBe("baseline");
    expect(transaction.artifacts().map((artifact) => artifact.target)).toEqual(["drafts/01.draft.md"]);
  });

  it("stages and commits every business artifact from the selected transaction", async () => {
    const dir = await mkdtemp(join(tmpdir(), "synchronicle-transaction-commit-"));
    const store = new Store(dir);
    await store.init();
    const transaction = store.recordingTransaction();
    await transaction.store.drafts.saveDraft(1, "candidate");
    await transaction.store.progress.save({ novel_name: "Book", phase: "writing", current_chapter: 1, total_chapters: 1, completed_chapters: [], total_word_count: 0 });
    const staging = await store.staging.createSession("selected");

    const ids = await transaction.stage(staging, 1);
    await store.commitStaged(staging, ids);

    expect(await store.drafts.loadDraft(1)).toBe("candidate");
    expect((await store.progress.load())?.novel_name).toBe("Book");
  });

  it("keeps rejected tool writes formal-zero and commits all selected tool artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "synchronicle-transaction-tools-"));
    const store = new Store(dir);
    await store.init();
    await store.progress.init("Book", 1);
    const rejected = store.recordingTransaction();
    const selected = store.recordingTransaction();
    await createToolRegistry({ store: rejected.store }).draft_chapter.execute({ chapter: 1, content: "rejected", mode: "write" });
    await createToolRegistry({ store: selected.store }).draft_chapter.execute({ chapter: 1, content: "selected", mode: "write" });

    expect(await store.drafts.loadDraft(1)).toBe("");
    expect((await store.progress.load())?.in_progress_chapter).toBe(0);
    expect(await store.checkpoints.all()).toHaveLength(0);

    const staging = await store.staging.createSession("tool-selected");
    const ids = await selected.stage(staging, 2);
    await staging.saveState({ phase: "committing", candidateIds: ids });
    await store.commitStaged(staging, ids);
    await staging.saveState({ phase: "completed", candidateIds: ids });

    expect(await store.drafts.loadDraft(1)).toBe("selected");
    expect((await store.progress.load())?.in_progress_chapter).toBe(1);
    expect(await store.checkpoints.latestByStep({ kind: "chapter", chapter: 1 }, "draft")).not.toBeNull();
    expect(await staging.loadState()).toEqual({ phase: "completed", candidateIds: ids });
  });

  it("stages multiple tool business artifacts before the checkpoint artifact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "synchronicle-transaction-order-"));
    const store = new Store(dir);
    await store.init();
    await store.progress.init("Book", 1);
    const transaction = store.recordingTransaction();
    const tools = createToolRegistry({ store: transaction.store });
    await tools.plan_chapter.execute({ chapter: 1, title: "One", goal: "g", conflict: "c", hook: "h" });
    await tools.draft_chapter.execute({ chapter: 1, content: "draft", mode: "write" });

    const targets = transaction.artifacts().map((artifact) => artifact.target);

    expect(targets.at(-1)).toBe("meta/checkpoints.jsonl");
    expect(targets.slice(0, -1)).toEqual(expect.arrayContaining(["drafts/01.plan.json", "drafts/01.draft.md", "meta/progress.json"]));
  });
});
