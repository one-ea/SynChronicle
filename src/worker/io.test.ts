import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import worker, { resetWorkerCache } from "../../worker/index.js";

/** better-sqlite3 → D1Database mock：?N 编号占位符映射为命名参数。 */
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
        run: async () => ({ meta: { changes: db.prepare(sql).run(...(names.length ? [bindObject(names, values)] : values)).changes } }),
        first: async <T>() => (db.prepare(sql).get(...(names.length ? [bindObject(names, values)] : values)) ?? null) as T | null,
        all: async <T>() => ({ results: db.prepare(sql).all(...(names.length ? [bindObject(names, values)] : values)) as T[] }),
      };
      return stmt;
    },
    batch: async (statements: Array<{ run(): Promise<unknown> }>) => { for (const statement of statements) await statement.run(); return []; },
  };
}

/** 内存 R2Bucket mock：put/get/head。 */
function r2(): { bucket: unknown; files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    bucket: {
      put: async (key: string, value: string) => { files.set(key, value); },
      get: async (key: string) => (files.has(key) ? { body: new Response(files.get(key)!).body, size: files.get(key)!.length } : null),
    },
  };
}

function env(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const stubHub = { fetch: async () => new Response(JSON.stringify({ snapshot: null, events: [] }), { headers: { "content-type": "application/json" } }) };
  return { DB: d1(new Database(":memory:")), RUNTIME: { get: () => stubHub }, MASTER_KEY: "a".repeat(64), INTERNAL_TOKEN: "tok-1", MODE: "selfhost", ...overrides };
}

async function call(environment: Record<string, unknown>, request: Request): Promise<Response> {
  return worker.fetch(request, environment as never);
}

const post = (path: string, cookie: string, body: unknown) => new Request(`https://edge${path}`, { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "fetch", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

const SAMPLE = "第1章 开端\n\n他推开门，雨夜的风灌进来。\n\n第2章 转折\n\n钟声在午夜响起。";

describe("worker import/export", () => {
  it("imports text into a new book, lists it, exports txt inline and via r2", async () => {
    resetWorkerCache();
    const environment = env();
    const setup = await call(environment, post("/api/auth/setup", "", { name: "admin", password: "test-password-1" }));
    expect(setup.status).toBe(200);
    const cookie = (setup.headers.get("set-cookie") ?? "").split(";")[0]!;

    const imported = await call(environment, post("/api/import", cookie, { title: "拆书之书", text: SAMPLE }));
    expect(imported.status).toBe(201);
    const importBody = await imported.json() as { imported: boolean; bookId: string; chapters: number };
    expect(importBody.imported).toBe(true);
    expect(importBody.chapters).toBe(2);

    const books = await call(environment, new Request("https://edge/api/books", { headers: { cookie } }));
    const booksBody = await books.json() as { books: Array<{ id: string; title: string }>; activeId: string | null };
    expect(booksBody.books.map((book) => book.id)).toContain(importBody.bookId);
    expect(booksBody.activeId).toBe(importBody.bookId);

    // 无 R2 绑定：内联导出
    const inline = await call(environment, post("/api/export", cookie, { bookId: importBody.bookId }));
    expect(inline.status).toBe(200);
    const inlineBody = await inline.json() as { stored: boolean; chapters: number; text: string };
    expect(inlineBody.stored).toBe(false);
    expect(inlineBody.chapters).toBe(2);
    expect(inlineBody.text).toContain("第 1 章");
    expect(inlineBody.text).toContain("雨夜的风");

    // 有 R2 绑定：落桶 + 下载
    resetWorkerCache();
    const environmentR2 = env();
    const setup2 = await call(environmentR2, post("/api/auth/setup", "", { name: "admin", password: "test-password-1" }));
    const cookie2 = (setup2.headers.get("set-cookie") ?? "").split(";")[0]!;
    const { bucket, files } = r2();
    environmentR2.EXPORTS = bucket;
    const imported2 = await call(environmentR2, post("/api/import", cookie2, { title: "拆书之书", text: SAMPLE }));
    const importBody2 = await imported2.json() as { bookId: string };
    const stored = await call(environmentR2, post("/api/export", cookie2, { bookId: importBody2.bookId }));
    expect(stored.status).toBe(201);
    const storedBody = await stored.json() as { stored: boolean; key: string; path: string };
    expect(storedBody.stored).toBe(true);
    expect(files.size).toBe(1);
    const download = await call(environmentR2, new Request(`https://edge${storedBody.path}`, { headers: { cookie: cookie2 } }));
    expect(download.status).toBe(200);
    expect(await download.text()).toContain("钟声在午夜响起");
  });

  it("rejects invalid chapter numbers and empty text", async () => {
    resetWorkerCache();
    const environment = env();
    const setup = await call(environment, post("/api/auth/setup", "", { name: "admin", password: "test-password-1" }));
    const cookie = (setup.headers.get("set-cookie") ?? "").split(";")[0]!;
    const empty = await call(environment, post("/api/import", cookie, { text: "   " }));
    expect(empty.status).toBe(400);
    const backwards = await call(environment, post("/api/import", cookie, { text: "第2章 倒序\n\n内容A\n\n第1章 回退\n\n内容B" }));
    expect(backwards.status).toBe(400);
    const exportMissing = await call(environment, post("/api/export", cookie, { bookId: "ghost" }));
    expect(exportMissing.status).toBe(400);
  });

  it("isolates export downloads by user prefix", async () => {
    resetWorkerCache();
    const environment = env();
    const setup = await call(environment, post("/api/auth/setup", "", { name: "admin", password: "test-password-1" }));
    const cookie = (setup.headers.get("set-cookie") ?? "").split(";")[0]!;
    const forged = await call(environment, new Request("https://edge/api/export/file/exports/someone-else/book.txt", { headers: { cookie } }));
    expect(forged.status).toBe(403);
  });
});
