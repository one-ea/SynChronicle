import { describe, expect, it } from "vitest";
import { BookMetaSchema, createBookId, emptyBookshelf, normalizeTitle, resolveBooksRoot } from "./bookshelf.js";

describe("bookshelf 多书管理", () => {
  it("resolves the books root as the parent of output_dir", () => {
    expect(resolveBooksRoot("output/novel")).toBe("output");
    expect(resolveBooksRoot("/data/books/my-book/")).toBe("/data/books");
    expect(resolveBooksRoot("novel")).toBe(".");
    expect(resolveBooksRoot("a\\b\\c")).toBe("a/b");
  });

  it("creates filesystem-safe unique ids", () => {
    const a = createBookId("Star Legend 2099");
    const b = createBookId("Star Legend 2099");
    expect(a).toMatch(/^star-legend-2099-\d{6}-[a-z0-9]{4}$/);
    expect(a).not.toBe(b);
    expect(createBookId("纯中文书名")).toMatch(/^book-\d{6}-[a-z0-9]{4}$/);
  });

  it("normalizes titles and starts with an empty shelf", () => {
    expect(normalizeTitle("  三体   与   黑暗森林 ")).toBe("三体 与 黑暗森林");
    expect(normalizeTitle("x".repeat(80)).length).toBe(60);
    expect(emptyBookshelf().books).toEqual([]);
    expect(emptyBookshelf().activeId).toBeNull();
  });

  it("migrates legacy book metadata with an empty owner", () => {
    const book = BookMetaSchema.parse({ id: "legacy", title: "旧书", createdAt: "now", updatedAt: "now" });
    expect(book.ownerId).toBe("");
  });
});
