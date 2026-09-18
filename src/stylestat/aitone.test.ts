import { describe, expect, it } from "vitest";
import { detectAitone } from "./aitone.js";

describe("detectAitone", () => {
  it("returns null for empty or blank text", () => {
    expect(detectAitone("")).toBeNull();
    expect(detectAitone("   \n ")).toBeNull();
  });

  it("detects each fatigue pattern category", () => {
    const samples = [
      { text: "他眼中闪过一丝了然。", hit: "量词癖" },
      { text: "她不禁笑出了声。", hit: "虚词癖" },
      { text: "那声音如同潮水一般涌来。", hit: "明喻套句" },
      { text: "这不是结束，而是开始。", hit: "对比定义句式" },
      { text: "某种程度上，他答应了。", hit: "抽象大词" },
    ];
    for (const sample of samples) {
      const result = detectAitone(sample.text)!;
      expect(result.hits.some((hit) => hit.name.includes(sample.hit))).toBe(true);
      expect(result.score).toBeLessThan(100);
    }
  });

  it("scores a clean text at 100 with no hits", () => {
    const result = detectAitone("他把扳手放回工具箱，擦了擦手上的油。窗外的雨停了。")!;
    expect(result.score).toBe(100);
    expect(result.hits).toEqual([]);
  });

  it("penalizes dense fatigue wording more than sparse wording", () => {
    const dense = Array.from({ length: 12 }, () => "他不禁勾起一抹笑意，仿佛释然了一般。").join("");
    const sparse = "他不禁勾起一抹笑意，仿佛释然了一般。" + "他把扳手放回工具箱，擦了擦手上的油。".repeat(40);
    expect(detectAitone(dense)!.score).toBeLessThan(detectAitone(sparse)!.score);
  });

  it("truncates samples to 12 characters and returns at most two per pattern", () => {
    const result = detectAitone("不知为何，他停了下来。不知为何，她又回头。不知为何，门开着。")!;
    const hit = result.hits.find((item) => item.name.includes("抽象大词"))!;
    expect(hit.samples).toHaveLength(2);
    for (const sample of hit.samples) expect([...sample].length).toBeLessThanOrEqual(12);
  });
});
