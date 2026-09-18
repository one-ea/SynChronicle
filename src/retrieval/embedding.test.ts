import { describe, expect, it, vi, afterEach } from "vitest";
import { cosineSimilarity, embedTexts } from "./embedding.js";

afterEach(() => { vi.unstubAllGlobals(); });

describe("embedding", () => {
  it("posts to the OpenAI-compatible endpoint and returns vectors in input order", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body)) as { model: string; input: string[] };
      expect(body.model).toBe("custom-embed");
      expect(body.input).toEqual(["甲", "乙"]);
      return new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }, { index: 1, embedding: [0, 1] }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const vectors = await embedTexts({ base_url: "http://embed.test/v1/", model: "custom-embed", api_key: "k" }, ["甲", "乙"]);
    expect(vectors).toEqual([[1, 0], [0, 1]]);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("http://embed.test/v1/embeddings");
  });

  it("throws without api_key and on non-200 responses", async () => {
    await expect(embedTexts({ model: "m" }, ["x"])).rejects.toThrow("api_key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 503 })));
    await expect(embedTexts({ api_key: "k" }, ["x"])).rejects.toThrow("503");
  });

  it("computes cosine similarity with direction and magnitude", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});
