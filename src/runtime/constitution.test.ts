import { describe, expect, it } from "vitest";
import { emptyConstitution, isEmptyConstitution } from "../domain/constitution.js";
import { renderConstitutionText } from "./constitution.js";
import type { Constitution } from "../domain/constitution.js";

describe("constitution 项目宪法", () => {
  it("returns empty string for empty constitution", () => {
    expect(renderConstitutionText(emptyConstitution())).toBe("");
    expect(isEmptyConstitution(emptyConstitution())).toBe(true);
  });

  it("renders all sections for a full constitution", () => {
    const constitution: Constitution = {
      worldRules: ["修炼者每次动用灵力必须付出寿命代价"],
      abilityCosts: ["千里传音每次消耗一年寿命"],
      forbiddenInfo: ["主角身世之谜在第三卷前不得揭晓"],
      secretReveals: [{ secret: "父亲失踪的真相", revealAt: "第 42 章" }],
      characterBoundaries: ["苏晚在第三卷前不知道沈砚的真实身份"],
    };
    const text = renderConstitutionText(constitution);
    expect(text).toContain("[项目宪法]");
    expect(text).toContain("寿命代价");
    expect(text).toContain("禁写信息");
    expect(text).toContain("第 42 章");
    expect(text).toContain("苏晚");
  });

  it("renders partial sections without empty labels", () => {
    const constitution: Constitution = { ...emptyConstitution(), worldRules: ["灵力不可隔空取物"] };
    const text = renderConstitutionText(constitution);
    expect(text).toContain("灵力不可隔空取物");
    expect(text).not.toContain("禁写信息");
  });
});
