import { describe, expect, it } from "vitest";
import { brainstorm, BRAINSTORM_TYPES, mulberry32 } from "./brainstorm.js";

describe("brainstorm 节点脑暴", () => {
  it("is deterministic for the same seed", () => {
    const first = brainstorm("sect", 6, 42);
    const second = brainstorm("sect", 6, 42);
    expect(first).toEqual(second);
    expect(first.length).toBe(6);
  });

  it("generates all eight types with deduplication", () => {
    for (const type of BRAINSTORM_TYPES) {
      const items = brainstorm(type, 8, 7);
      expect(items.length).toBeGreaterThanOrEqual(3);
      expect(new Set(items).size).toBe(items.length);
    }
    expect(brainstorm("sect", 8, 7)[0]!).toMatch(/[宗门阁山庄谷教派寺]$/);
    expect(brainstorm("name", 8, 7).every((name) => name.length >= 2 && name.length <= 4)).toBe(true);
    expect(brainstorm("hook", 3, 7).every((hook) => hook.includes("。"))).toBe(true);
  });

  it("returns empty for invalid input", () => {
    expect(brainstorm("sect", 0, 1)).toEqual([]);
    expect(brainstorm("sect", -2, 1)).toEqual([]);
    expect(brainstorm("sect" as never, 2.5, 1)).toEqual([]);
  });

  it("mulberry32 is a stable prng", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
