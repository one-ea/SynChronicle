import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "../store/index.js";
import { buildRecallCorpus, recall } from "./recall.js";

async function seed() {
  const dir = await mkdtemp(join(tmpdir(), "recall-"));
  const store = new Store(dir);
  await store.init();
  await store.entities.upsertEntity({ id: "shen-yan", name: "沈砚", type: "character", aliases: ["阿砚"], description: "雨夜书局的年轻掌柜，记忆力异于常人", relations: [], states: [] });
  await store.outline.saveOutline([{ chapter: 1, title: "雨夜", core_event: "发现钥匙", hook: "钟声", scenes: ["书局"] }]);
  await store.summaries.saveSummary({ chapter: 1, summary: "沈砚在雨夜书局发现旧钟楼的钥匙", characters: ["沈砚"], key_events: ["发现钥匙"] });
  await store.outline.saveCompass({ ending_direction: "和解", open_threads: ["旧钟楼的钥匙的秘密"] });
  return store;
}

describe("recall 设定检索", () => {
  it("builds corpus from entities, summaries and foreshadow threads", async () => {
    const store = await seed();
    const corpus = await buildRecallCorpus(store);
    expect(corpus.map((doc) => doc.kind)).toEqual(["entity", "summary", "foreshadow"]);
    expect(corpus[0]!.text).toContain("沈砚");
    expect(corpus[1]!.source).toContain("第 1 章");
    expect(corpus[2]!.text).toContain("伏笔");
  });

  it("ranks entity hits for a name query via bm25", async () => {
    const store = await seed();
    const result = await recall(store, "沈砚 掌柜");
    expect(result.engine).toBe("bm25");
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0]!.kind).toBe("entity");
    expect(result.hits[0]!.source).toBe("沈砚");
    expect(result.hits[0]!.snippet.length).toBeLessThanOrEqual(130);
  });

  it("returns empty hits for blank query or empty store", async () => {
    const store = await seed();
    expect((await recall(store, "   ")).hits).toEqual([]);
    const dir = await mkdtemp(join(tmpdir(), "recall-empty-"));
    const empty = new Store(dir);
    await empty.init();
    expect((await recall(empty, "任意")).hits).toEqual([]);
  });
});
