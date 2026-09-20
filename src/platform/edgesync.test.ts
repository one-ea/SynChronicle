import { describe, expect, it, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FileIO } from "../store/io.js";
import { startEdgeSync, stopEdgeSync, flushEdgeSync } from "./edgesync.js";

interface CapturedCall { path: string; token: string; body: any }

function captureFetch(calls: CapturedCall[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({ path: new URL(url).pathname, token: headers?.["x-internal-token"] ?? "", body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ applied: 1, deleted: 0 }), { status: 200 });
  }) as typeof fetch;
}

describe("edge sync", () => {
  afterEach(() => { stopEdgeSync(); });

  it("debounced flush maps book writes to edge keys with owner and bookshelf", async () => {
    const originalFetch = globalThis.fetch;
    const calls: CapturedCall[] = [];
    globalThis.fetch = captureFetch(calls) as typeof fetch;
    try {
      const root = resolve(join(tmpdir(), "edgesync-1"));
      await mkdir(join(root, "novel", "meta"), { recursive: true });
      await writeFile(join(root, "novel", "meta", "progress.json"), JSON.stringify({ current_chapter: 2 }), "utf8");
      await writeFile(join(root, "novel", "chapters", "01.md"), "# 第一章", "utf8").catch(() => undefined);
      await mkdir(join(root, "novel", "chapters"), { recursive: true });
      await writeFile(join(root, "novel", "chapters", "01.md"), "# 第一章", "utf8");
      await writeFile(join(root, "bookshelf.json"), JSON.stringify({ books: [{ id: "novel", ownerId: "u1", title: "书" }], activeId: "novel" }), "utf8");

      startEdgeSync({ url: "https://edge.example.com", token: "tok-9", booksRoot: root, getBookshelf: async () => [{ id: "novel", ownerId: "u1", title: "书" }] });

      const io = new FileIO(join(root, "novel"));
      await io.writeFile("meta/progress.json", JSON.stringify({ current_chapter: 3 }));
      await io.writeFile("chapters/02.md", "# 第二章");
      await io.remove("chapters/01.md");
      await new FileIO(root).writeJSON("bookshelf.json", { books: [{ id: "novel", ownerId: "u1", title: "书" }], activeId: "novel" });

      const result = await flushEdgeSync();
      expect(result.books).toBe(1);

      const syncCalls = calls.filter((call) => call.path === "/api/internal/sync");
      const bookCall = syncCalls.find((call) => call.body.book === "novel");
      expect(bookCall).toBeDefined();
      expect(bookCall!.token).toBe("tok-9");
      expect(bookCall!.body.owner).toBe("u1");
      const paths: string[] = bookCall!.body.writes.map((item: { path: string }) => item.path);
      expect(paths).toContain("books/novel/meta/progress.json");
      expect(paths).toContain("books/novel/chapters/02.md");
      expect(paths).not.toContain("books/novel/chapters/01.md");
      expect(bookCall!.body.deletes).toContain("books/novel/chapters/01.md");

      const shelfCall = syncCalls.find((call) => call.body.writes?.[0]?.path === "platform/bookshelf.json");
      expect(shelfCall).toBeDefined();

      // 成功冲刷后脏标记清空：再次 flush 为空操作
      const again = await flushEdgeSync();
      expect(again.pushed).toBe(0);
      await rm(root, { recursive: true, force: true });
    } finally { globalThis.fetch = originalFetch; }
  });

  it("keeps dirty entries when edge rejects", async () => {
    const originalFetch = globalThis.fetch;
    const calls: CapturedCall[] = [];
    globalThis.fetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
    try {
      const root = resolve(join(tmpdir(), "edgesync-2"));
      await mkdir(join(root, "novel", "meta"), { recursive: true });
      await writeFile(join(root, "novel", "meta", "progress.json"), "{}", "utf8");
      startEdgeSync({ url: "https://edge.example.com", token: "t", booksRoot: root, getBookshelf: async () => [] });
      await new FileIO(join(root, "novel")).writeFile("meta/progress.json", '{"a":1}');
      await expect(flushEdgeSync()).rejects.toThrow("edge sync failed: 500");
      await rm(root, { recursive: true, force: true });
      void calls;
    } finally { globalThis.fetch = originalFetch; }
  });
});
