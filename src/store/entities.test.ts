import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileIO } from "./io.js";
import { EntityStore } from "./entities.js";

describe("EntityStore", () => {
  it("initializes empty entities file if not exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sync-entity-test-"));
    try {
      const store = new EntityStore(new FileIO(dir));
      const data = await store.load();
      expect(data.entities).toEqual([]);
      expect(data.updatedAt).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("upserts entity and merges aliases and relations safely", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sync-entity-test-"));
    try {
      const store = new EntityStore(new FileIO(dir));
      await store.upsertEntity({
        id: "hero",
        name: "李林",
        type: "character",
        aliases: ["小林"],
        description: "主角，身怀神秘玉佩",
        relations: [{ targetId: "mentor", type: "mentor", strength: 80 }],
        states: [{ chapter: 1, mood: "迷茫", goals: ["寻找身世"] }],
      });

      const loaded = await store.getEntity("hero");
      expect(loaded?.name).toBe("李林");
      expect(loaded?.aliases).toContain("小林");

      // 增量 upsert: 新增别名与关系
      await store.upsertEntity({
        id: "hero",
        name: "李林",
        type: "character",
        aliases: ["青云剑客"],
        description: "实力进阶",
        relations: [{ targetId: "rival", type: "enemy", strength: -60 }],
        states: [{ chapter: 5, mood: "坚定", goals: ["报仇"] }],
      });

      const updated = await store.getEntity("小林");
      expect(updated).toBeDefined();
      expect(updated?.aliases).toEqual(["小林", "青云剑客"]);
      expect(updated?.relations).toHaveLength(2);
      expect(updated?.states).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("links relation between entities", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sync-entity-test-"));
    try {
      const store = new EntityStore(new FileIO(dir));
      await store.upsertEntity({
        id: "faction-a",
        name: "青云宗",
        type: "faction",
        aliases: [],
        description: "正道宗门",
        relations: [],
        states: [],
      });

      await store.linkRelation("faction-a", {
        targetId: "faction-b",
        type: "ally",
        description: "共御魔潮盟约",
        strength: 90,
      });

      const faction = await store.getEntity("faction-a");
      expect(faction?.relations[0]?.targetId).toBe("faction-b");
      expect(faction?.relations[0]?.type).toBe("ally");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
