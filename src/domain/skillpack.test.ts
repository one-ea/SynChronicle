import { describe, expect, it } from "vitest";
import { BUILTIN_SKILL_PACKS, effectiveSkillPacks, emptySkillPackFile, renderSkillPacks, SkillPackFileSchema } from "./skillpack.js";

describe("skillpack 技能包", () => {
  it("ships eight builtin packs with at least four techniques each", () => {
    expect(BUILTIN_SKILL_PACKS.length).toBe(8);
    for (const pack of BUILTIN_SKILL_PACKS) {
      expect(pack.id).toBeTruthy();
      expect(pack.techniques.length).toBeGreaterThanOrEqual(4);
      expect(pack.origin).toBe("builtin");
    }
    const ids = new Set(BUILTIN_SKILL_PACKS.map((pack) => pack.id));
    expect(ids.size).toBe(BUILTIN_SKILL_PACKS.length);
  });

  it("renders enabled packs as a prompt block and skips when empty", () => {
    expect(renderSkillPacks([])).toBe("");
    const text = renderSkillPacks([BUILTIN_SKILL_PACKS[0]!]);
    expect(text).toContain("[写作技法]");
    expect(text).toContain(`# ${BUILTIN_SKILL_PACKS[0]!.name}`);
    expect(text).toContain("- ");
  });

  it("filters builtin and custom packs by the enabled id list", () => {
    const custom = { id: "custom-x", name: "我的包", category: "自定义", description: "", techniques: ["多用动作 beats"], origin: "custom" as const };
    const file = SkillPackFileSchema.parse({ enabled: [BUILTIN_SKILL_PACKS[0]!.id, "custom-x"], custom: [custom] });
    const packs = effectiveSkillPacks(file);
    expect(packs.map((pack) => pack.id)).toEqual([BUILTIN_SKILL_PACKS[0]!.id, "custom-x"]);
    expect(effectiveSkillPacks(emptySkillPackFile())).toEqual([]);
  });
});
