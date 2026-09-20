import { describe, expect, it, afterEach } from "vitest";
import Database from "better-sqlite3";
import worker, { resetWorkerCache } from "../../worker/index.js";
import { normalizeReport, parseJsonBlock } from "../../worker/review.js";

/** better-sqlite3 → D1Database mock（?N → 命名参数）。 */
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

function sseBody(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({ start(controller) { for (const line of lines) controller.enqueue(encoder.encode(line)); controller.close(); } });
}

const originalFetch = globalThis.fetch;

describe("edge review", () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("parses fenced json and degrades gracefully", () => {
    const parsed = parseJsonBlock("前置说明\n```json\n{\"score\": 88, \"verdict\": \"弧线扎实\", \"issues\": [{\"chapter\": 2, \"severity\": \"high\", \"note\": \"节奏拖沓\"}], \"suggestions\": [\"收紧第 2 章\"]}\n```\n");
    expect(parsed).not.toBeNull();
    const report = normalizeReport(JSON.stringify(parsed), [1, 2], { input: 100, output: 40 }, "2026-09-20T00:00:00Z");
    expect(report.score).toBe(88);
    expect(report.verdict).toBe("弧线扎实");
    expect(report.issues[0]!.chapter).toBe(2);
    expect(report.suggestions).toEqual(["收紧第 2 章"]);
    const degraded = normalizeReport("这不是 JSON", [1], { input: 1, output: 1 }, "t");
    expect(degraded.score).toBeNull();
    expect(degraded.verdict).toContain("这不是 JSON");
  });

  it("runs arc review over chapter digests, persists report and bills", async () => {
    resetWorkerCache();
    const db = new Database(":memory:");
    const environment = { DB: d1(db), RUNTIME: { idFromName: () => "i", get: () => ({ fetch: async () => new Response("{}", { headers: { "content-type": "application/json" } }) }) }, MASTER_KEY: "1".repeat(64), INTERNAL_TOKEN: "tok-1", MODE: "commercial" };
    const call = (request: Request) => worker.fetch(request, environment as never);
    const post = (path: string, cookie: string, body: unknown) => new Request(`https://edge${path}`, { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "fetch", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

    await call(new Request("https://edge/api/health"));
    const adminHash = await pbkdf2("admin-pw-123456", "salt-a");
    db.prepare("INSERT INTO users (id, name, password_salt, password_hash, role, status, quota_usd_remaining, quota_usd_used, created_at, updated_at) VALUES ('boss', 'boss', 'salt-a', ?, 'admin', 'active', 0, 0, 't', 't')").run(adminHash);
    const adminLogin = await call(post("/api/auth/login", "", { name: "boss", password: "admin-pw-123456" }));
    const adminCookie = (adminLogin.headers.get("set-cookie") ?? "").split(";")[0]!;
    const invites = await call(post("/api/admin/invite-codes", adminCookie, { count: 1, grantedUsd: 1 }));
    const inviteCode = ((await invites.json()) as { codes: string[] }).codes[0]!;
    const register = await call(post("/api/auth/register", "", { name: "writer", password: "writer-pw-123456", inviteCode }));
    const writerCookie = (register.headers.get("set-cookie") ?? "").split(";")[0]!;
    const imported = await call(post("/api/import", writerCookie, { title: "评审之书", text: "第1章 开端\n\n正文一。" }));
    const bookId = ((await imported.json()) as { bookId: string }).bookId;
    await call(post("/api/channels", writerCookie, { name: "渠道", provider: "openai", baseUrl: "https://upstream.example.com/v1", apiKey: "sk-review-secret-1234", models: ["deepseek-chat"] }));
    // 直接写两条摘要供评审汇编（已存在的键用 upsert）
    const kvSet = (path: string, content: string) => db.prepare("INSERT INTO kv_files (path, content, updated_at) VALUES (?, ?, 't') ON CONFLICT(path) DO UPDATE SET content = excluded.content").run(path, content);
    kvSet(`books/${bookId}/summaries/01.json`, JSON.stringify({ chapter: 1, summary: "开端铺垫" }));
    kvSet(`books/${bookId}/chapters/02.md`, "# 第二章\n\n正文二的内容。");
    kvSet(`books/${bookId}/meta/progress.json`, JSON.stringify({ novel_name: "评审之书", completed_chapters: [1, 2] }));

    const upstreamBodies: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (request.url.includes("upstream.example.com")) {
        const payload = JSON.parse(await request.text()) as { messages: Array<{ role: string; content: string }> };
        upstreamBodies.push(payload.messages.at(-1)?.content ?? "");
        return new Response(sseBody([
          'data: {"choices":[{"delta":{"content":"{\\"score\\": 91, \\"verdict\\": \\"双章弧线完整\\", \\"issues\\": [{\\"chapter\\": 2, \\"severity\\": \\"medium\\", \\"note\\": \\"悬念回收稍快\\"}], \\"suggestions\\": [\\"延长第二章铺垫\\"]}"}}]}\n\n',
          'data: {"usage":{"prompt_tokens":600,"completion_tokens":150}}\n\n',
          "data: [DONE]\n\n",
        ]), { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return originalFetch(request);
    }) as typeof fetch;

    const review = await call(post("/api/review", writerCookie, { bookId, premise: "书局悬疑" }));
    expect(review.status).toBe(201);
    const reviewBody = await review.json() as { report: { score: number; verdict: string; chapters: number[]; issues: Array<{ note: string }> } };
    expect(reviewBody.report.score).toBe(91);
    expect(reviewBody.report.chapters).toEqual([1, 2]);
    expect(reviewBody.report.issues[0]!.note).toBe("悬念回收稍快");

    // 评审上下文包含两条摘要/回退正文
    expect(upstreamBodies[0]).toContain("开端铺垫");
    expect(upstreamBodies[0]).toContain("正文二的内容");

    // 报告持久化
    const list = await call(new Request(`https://edge/api/reviews?book=${bookId}`, { headers: { cookie: writerCookie } }));
    const listBody = await list.json() as { reports: Array<{ id: string; score: number }> };
    expect(listBody.reports).toHaveLength(1);
    expect(listBody.reports[0]!.score).toBe(91);

    // 计费：agent=review
    const ledger = db.prepare("SELECT * FROM usage_ledger WHERE agent = 'review'").all() as Array<{ tokens_in: number; cost_usd: number }>;
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.tokens_in).toBe(600);
    expect(ledger[0]!.cost_usd).toBeGreaterThan(0);

    // 无章节书籍拒绝
    const empty = await call(post("/api/review", writerCookie, { bookId: `${bookId}-x` }));
    expect(empty.status).toBe(403);
  });
});

async function pbkdf2(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 100_000 }, key, 512);
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
