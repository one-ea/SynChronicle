import { describe, expect, it } from "vitest";
import { buildNegativeConstraints, buildRewritePlan, loadStyleGuide } from "./rewrite.js";
import { detectAitone } from "../stylestat/aitone.js";

describe("runtime rewrite", () => {
  it("loads valid style guides and falls back gracefully", async () => {
    const suspense = await loadStyleGuide("suspense");
    expect(suspense).toContain("悬疑推理风格");
    const fallback = await loadStyleGuide("non-existent");
    expect(fallback).toContain("写作风格");
  });

  it("extracts negative constraints from detected AI tone patterns", () => {
    const sample = "他不禁皱起了眉，仿佛潮水一般涌来，某种程度上让人说不清道不明。";
    const aitone = detectAitone(sample);
    expect(aitone).not.toBeNull();
    const constraints = buildNegativeConstraints(aitone);
    expect(constraints.length).toBeGreaterThan(0);
    expect(constraints.some((c) => c.includes("不禁") || c.includes("虚词癖"))).toBe(true);
  });

  it("assembles complete rewrite plan with constraints and style guide", async () => {
    const sample = "她心中有一丝不安，不是害怕，而是兴奋。";
    const plan = await buildRewritePlan(sample, 3, {
      style: "romance",
      instructions: "增加心理细腻描写",
      reduceAitone: true,
    });
    expect(plan.styleName).toBe("romance");
    expect(plan.systemInstruction).toContain("第 3 章");
    expect(plan.systemInstruction).toContain("负向去AI味红线");
    expect(plan.systemInstruction).toContain("增加心理细腻描写");
    expect(plan.userPrompt).toContain(sample);
  });
});
