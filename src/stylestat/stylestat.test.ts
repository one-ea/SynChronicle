import { describe, expect, it } from "vitest";
import { compute } from "./index.js";

describe("stylestat", () => {
  it("requires five chapters and computes global facts", () => {
    expect(compute({ chapters: ["a", "b", "c", "d"], titles: [], stopwords: [] })).toBeNull();
    const body = "# 标题\n一整夜。他不是愤怒，而是恐惧。沉默了几息。像一盏灯。\n他走了。";
    const stats = compute({ chapters: Array(5).fill(body), titles: ["第一章 A", "B"], stopwords: [] });
    expect(stats?.patterns.length).toBeGreaterThan(0);
    expect(stats?.ending.shortRatio).toBe(1);
    expect(stats?.openingTimeRate).toBe(1);
    expect(stats?.titleFormats).toEqual({ withPrefix: 1, withoutPrefix: 1 });
  });
});
