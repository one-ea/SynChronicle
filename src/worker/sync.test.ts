import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import worker, { resetWorkerCache } from "../../worker/index.js";

/** better-sqlite3 包装成 D1Database：?N 编号占位符映射为命名参数（支持复用）。 */
function d1(db: Database.Database): unknown {
  const translate = (sql: string): { sql: string; names: string[] } => {
    const names: string[] = [];
    const converted = sql.replace(/\?(\d+)/g, (_match, index: string) => {
      const name = `p${index}`;
      if (!names.includes(name)) names.push(name);
      return `@${name}`;
    });
    return { sql: converted, names };
  };
  const bindObject = (names: string[], values: unknown[]): Record<string, unknown> => {
    const bound: Record<string, unknown> = {};
    names.forEach((name, index) => { bound[name] = values[index]; });
    return bound;
  };
  return {
    prepare(source: string) {
      const { sql, names } = translate(source);
      let values: unknown[] = [];
      const stmt = {
        bind: (...input: unknown[]) => { values = input; return stmt; },
        run: async () => { db.prepare(sql).run(...(names.length ? [bindObject(names, values)] : values)); return { success: true }; },
        first: async <T>() => (db.prepare(sql).get(...(names.length ? [bindObject(names, values)] : values)) ?? null) as T | null,
        all: async <T>() => ({ results: db.prepare(sql).all(...(names.length ? [bindObject(names, values)] : values)) as T[] }),
      };
      return stmt;
    },
    batch: async (statements: Array<{ run(): Promise<unknown> }>) => { for (const statement of statements) await statement.run(); return []; },
  };
}

function env(): { DB: unknown; RUNTIME: unknown; MASTER_KEY: string; INTERNAL_TOKEN: string; MODE?: string } {
  const stubHub = {
    fetch: async () => new Response(JSON.stringify({ snapshot: null, events: [] }), { headers: { "content-type": "application/json" } }),
  };
  return { DB: d1(new Database(":memory:")), RUNTIME: { get: () => stubHub }, MASTER_KEY: "a".repeat(64), INTERNAL_TOKEN: "tok-1", MODE: "selfhost" };
}

async function call(environment: ReturnType<typeof env>, request: Request): Promise<Response> {
  return worker.fetch(request, environment as never);
}

const post = (path: string, token: string, body: unknown) => new Request(`https://edge${path}`, { method: "POST", headers: { "content-type": "application/json", "x-internal-token": token }, body: JSON.stringify(body) });

describe("edge sync routes", () => {
  it("rejects sync without valid token", async () => {
    resetWorkerCache();
    const response = await call(env(), post("/api/internal/sync", "wrong", { book: "b1", writes: [] }));
    expect(response.status).toBe(403);
  });

  it("applies validated writes and serves books with ownership", async () => {
    resetWorkerCache();
    const environment = env();
    const applied = await call(environment, post("/api/internal/sync", "tok-1", {
      book: "b1", owner: "u-owner",
      writes: [
        { path: "books/b1/meta/progress.json", content: JSON.stringify({ completed_chapters: [1] }) },
        { path: "books/b1/chapters/01.md", content: "# 第一章\n\n温和的故事。" },
      ],
      deletes: [],
    }));
    expect(applied.status).toBe(200);
    expect(await applied.json()).toEqual({ applied: 2, deleted: 0 });

    await call(environment, post("/api/internal/sync", "tok-1", {
      writes: [{ path: "platform/bookshelf.json", content: JSON.stringify({ books: [{ id: "b1", title: "同步之书", ownerId: "u-owner" }], activeId: "b1" }) }],
      deletes: [],
    }));

    // 书城匿名可读已发布章节（kv 内容就位）
    await call(environment, post("/api/internal/sync", "tok-1", {
      writes: [{ path: "platform/published.json", content: JSON.stringify({ entries: [{ id: "b1", title: "同步之书", visibility: "public", publishedAt: "2026-01-01T00:00:00Z" }], updatedAt: "t" }) }],
      deletes: [],
    }));
    const shelf = await call(environment, new Request("https://edge/api/shelf"));
    const shelfBody = await shelf.json() as { entries: Array<{ id: string }> };
    expect(shelfBody.entries.map((entry) => entry.id)).toContain("b1");

    // 非法路径拒绝
    const evil = await call(environment, post("/api/internal/sync", "tok-1", { book: "b1", writes: [{ path: "books/other/secret.txt", content: "x" }] }));
    expect(evil.status).toBe(400);

    // 未登录不可见书籍列表
    const anon = await call(environment, new Request("https://edge/api/books"));
    expect(anon.status).toBe(401);

    // 自用 setup 管理员后读取书籍列表
    const setup = await call(environment, new Request("https://edge/api/auth/setup", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "fetch" }, body: JSON.stringify({ name: "admin", password: "test-password-1" }) }));
    expect(setup.status).toBe(200);
    const cookie = (setup.headers.get("set-cookie") ?? "").split(";")[0]!;
    const books = await call(environment, new Request("https://edge/api/books", { headers: { cookie } }));
    const booksBody = await books.json() as { books: Array<{ id: string; ownerId: string }>; activeId: string | null };
    expect(booksBody.books.map((book) => book.id)).toContain("b1");
    expect(booksBody.activeId).toBe("b1");
  });

  it("rejects oversized and malformed payloads", async () => {
    resetWorkerCache();
    const environment = env();
    const tooMany = await call(environment, post("/api/internal/sync", "tok-1", { book: "b1", writes: Array.from({ length: 101 }, (_, index) => ({ path: `books/b1/chapters/${index}.md`, content: "x" })) }));
    expect(tooMany.status).toBe(400);
    const malformed = await call(environment, post("/api/internal/sync", "tok-1", { book: "b1", writes: [{ path: "books/b1/a.md" }] }));
    expect(malformed.status).toBe(400);
  });
});
