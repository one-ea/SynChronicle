import { describe, expect, it } from "vitest";
import { loadAssets, overridePrompt } from "./load.js";

describe("assets", () => {
  it("loads every asset group and caches bundles", () => {
    const first = loadAssets("fantasy");
    const second = loadAssets("fantasy");
    expect(first).toBe(second);
    expect(first.prompts.coordinator).toContain("仿写画像");
    expect(first.references.styleReference).toBeTruthy();
    expect(first.styles.default).toBeTruthy();
  });

  it("wraps prompt overrides through the same guidance", () => {
    const bundle = structuredClone(loadAssets("default"));
    overridePrompt(bundle, "writer.md", "replacement");
    expect(bundle.prompts.writer).toContain("replacement");
    expect(bundle.prompts.writer).toContain("writer");
    expect(() => overridePrompt(bundle, "unknown.md", "x")).toThrow(/不支持/);
  });
});
