import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "../store/index.js";
import { buildRecallCorpus, recall } from "../retrieval/recall.js";

async function seedStore() {
  const dir = await mkdtemp(join(tmpdir(), "materials-"));
  const store = new Store(dir);
  await store.init();
  return store;
}

describe("materials 素材库", () => {
  it("adds, lists and removes materials", async () => {
    const store = await seedStore();
    const added = await store.materials.add({ type: "line", title: "雨夜对白", content: "“这么晚还来？”", tags: ["对白"], source: "manual" });
    expect(added.id).toMatch(/^mt-/);
    const list = await store.materials.load();
    expect(list.materials).toHaveLength(1);
    expect(list.materials[0]!.title).toBe("雨夜对白");

    const removed = await store.materials.remove(added.id);
    expect(removed).toBe(true);
    expect((await store.materials.remove(added.id))).toBe(false);
    expect((await store.materials.load()).materials).toHaveLength(0);
  });

  it("feeds materials into recall corpus", async () => {
    const store = await seedStore();
    await store.materials.add({ type: "setting", title: "旧钟楼设定", content: "钟楼每年冬至会自己鸣响一次", tags: ["设定"], source: "manual" });
    const corpus = await buildRecallCorpus(store);
    expect(corpus.some((doc) => doc.kind === "material" && doc.source === "旧钟楼设定")).toBe(true);
    const result = await recall(store, "钟楼 鸣响");
    expect(result.hits[0]!.kind).toBe("material");
  });
});
