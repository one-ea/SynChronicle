import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./index.js";
import { storeContract } from "./store.contract.js";

const tempStore = async () => {
  const dir = await mkdtemp(join(tmpdir(), "synchronicle-store-"));
  const store = new Store(dir);
  await store.init();
  return { dir, store };
};

describe("Store", () => {
  storeContract(async () => (await tempStore()).store);
  it("creates the Go-compatible directory tree", async () => {
    const { dir, store } = await tempStore();
    expect(store.dir).toBe(dir);
    await expect(readFile(join(dir, "meta", "progress.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("persists lower-case progress schema and reports consistency warnings", async () => {
    const { dir, store } = await tempStore();
    await store.progress.init("test", 10);
    await store.progress.startChapter(1);
    await store.progress.markChapterComplete(1, 5000, "", "");
    const raw = JSON.parse(await readFile(join(dir, "meta", "progress.json"), "utf8"));
    expect(raw).toMatchObject({ novel_name: "test", completed_chapters: [1], chapter_word_counts: { "1": 5000 } });
    expect(await store.checkConsistency()).toEqual(["progress 标记第 1 章已完成，但 chapters/01.md 不存在或为空"]);
  });

  it("reports foundation fields in stable order and requires compass for layered books", async () => {
    const { store } = await tempStore();
    expect(await store.foundationMissing()).toEqual(["premise", "outline", "characters", "world_rules"]);
    await store.outline.savePremise("premise");
    await store.outline.saveOutline([{ chapter: 1, title: "一", core_event: "开局", hook: "", scenes: [] }]);
    await store.characters.save([{ name: "林墨", role: "主角", description: "", arc: "", traits: [] }]);
    await store.world.saveWorldRules([{ category: "magic", rule: "有限", boundary: "" }]);
    await store.outline.saveLayeredOutline([{ index: 1, title: "卷一", theme: "起", arcs: [{ index: 1, title: "弧一", goal: "", chapters: [{ chapter: 1, title: "一", core_event: "开局", hook: "", scenes: [] }] }] }]);
    expect(await store.foundationMissing()).toEqual(["compass"]);
  });

  it("appends checkpoints idempotently and tolerates a truncated JSONL tail", async () => {
    const { dir, store } = await tempStore();
    const scope = { kind: "chapter" as const, chapter: 1 };
    const first = await store.checkpoints.append(scope, "plan", "drafts/01.plan.json", "sha256:abc");
    const duplicate = await store.checkpoints.append(scope, "plan", "drafts/01.plan.json", "sha256:abc");
    expect(duplicate.seq).toBe(first.seq);
    await writeFile(join(dir, "meta", "checkpoints.jsonl"), `${JSON.stringify(first)}\n{`, "utf8");
    const restored = new Store(dir);
    expect(await restored.checkpoints.all()).toHaveLength(1);
    expect((await restored.checkpoints.latestGlobal())?.seq).toBe(1);
  });

  it("preserves JSON, JSONL, and Markdown paths", async () => {
    const { dir, store } = await tempStore();
    await store.drafts.saveChapterPlan({ chapter: 2, title: "", goal: "", conflict: "", hook: "" });
    await store.drafts.saveDraft(2, "草稿");
    await store.drafts.saveFinalChapter(2, "终稿");
    await store.runtime.appendQueue({ seq: 0, time: "", kind: "ui_event", priority: "background", summary: "x" });
    expect(await readFile(join(dir, "drafts", "02.plan.json"), "utf8")).toContain('"chapter": 2');
    expect(await readFile(join(dir, "drafts", "02.draft.md"), "utf8")).toBe("草稿");
    expect(await readFile(join(dir, "chapters", "02.md"), "utf8")).toBe("终稿");
    expect(await readFile(join(dir, "meta", "runtime", "queue.jsonl"), "utf8")).toContain('"seq":1');
  });
});
