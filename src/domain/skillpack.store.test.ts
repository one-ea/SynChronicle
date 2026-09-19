import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileIO } from "../store/io.js";
import { SkillPackStore } from "../store/skillpacks.js";
import { BUILTIN_SKILL_PACKS } from "./skillpack.js";

async function makeStore(): Promise<SkillPackStore> {
  const dir = await mkdtemp(join(tmpdir(), "skillpacks-"));
  return new SkillPackStore(new FileIO(dir));
}

describe("SkillPackStore", () => {
  it("toggles builtin packs and persists state", async () => {
    const store = await makeStore();
    await store.toggle(BUILTIN_SKILL_PACKS[0]!.id, true);
    expect((await store.load()).enabled).toEqual([BUILTIN_SKILL_PACKS[0]!.id]);
    await store.toggle(BUILTIN_SKILL_PACKS[0]!.id, false);
    expect((await store.load()).enabled).toEqual([]);
  });

  it("rejects toggling unknown pack ids", async () => {
    const store = await makeStore();
    await expect(store.toggle("nope", true)).rejects.toThrow("技能包不存在");
  });

  it("appends and removes custom packs", async () => {
    const store = await makeStore();
    const pack = { id: "custom-1", name: "短句包", category: "自定义", description: "", techniques: ["高潮段落句长压到十字内"], origin: "custom" as const };
    await store.appendCustom(pack);
    await store.toggle("custom-1", true);
    const loaded = await store.load();
    expect(loaded.custom.map((item) => item.id)).toEqual(["custom-1"]);
    expect(loaded.enabled).toContain("custom-1");
    expect(await store.removeCustom("custom-1")).toBe(true);
    expect((await store.load()).enabled).toEqual([]);
    expect(await store.removeCustom("custom-1")).toBe(false);
  });
});
