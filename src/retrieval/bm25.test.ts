import { describe, expect, it } from "vitest";
import { bm25Search, tokenize, type Bm25Doc } from "./bm25.js";

describe("tokenize", () => {
  it("splits CJK runs into bigrams and ASCII into words", () => {
    expect(tokenize("海上空间站")).toEqual(["海上", "上空", "空间", "间站"]);
    expect(tokenize("Station 42")).toEqual(["station", "42"]);
  });
});

describe("bm25Search", () => {
  const docs: Bm25Doc[] = [
    { id: 1, text: "主角在吊坠里发现了古老封印，封印与玉佩相关" },
    { id: 2, text: "舰队完成了补给，继续向深空航行" },
    { id: 3, text: "厨房里的晚餐冒着热气，众人围坐吃饭" },
  ];

  it("ranks the relevant chapter above unrelated ones", () => {
    const hits = bm25Search(docs, "玉佩 封印 的秘密", 3);
    expect(hits[0]!.id).toBe(1);
    expect(hits.length).toBeGreaterThan(0);
  });

  it("truncates to k results", () => {
    expect(bm25Search(docs, "航行 补给 深空", 1)).toHaveLength(1);
  });

  it("returns empty for empty corpus, blank query, or non-positive k", () => {
    expect(bm25Search([], "任意", 3)).toEqual([]);
    expect(bm25Search(docs, "   ", 3)).toEqual([]);
    expect(bm25Search(docs, "航行", 0)).toEqual([]);
  });

  it("breaks score ties by ascending chapter id", () => {
    const twins: Bm25Doc[] = [{ id: 7, text: "同一场景" }, { id: 4, text: "同一场景" }];
    const hits = bm25Search(twins, "同一场景", 2);
    expect(hits.map((hit) => hit.id)).toEqual([4, 7]);
  });
});
