import { describe, expect, it, afterEach } from "vitest";
import Database from "better-sqlite3";
import worker, { resetWorkerCache } from "../../worker/index.js";

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
        run: async () => ({ meta: { changes: db.prepare(sql).run(...(names.length ? [bindObject(names, values)] : values)).changes } }),
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

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

describe("edge autopilot", () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("runs arc, reviews below threshold, rewrites, passes on second review", async () => {
    resetWorkerCache();
    const db = new Database(":memory:");
    const environment = { DB: d1(db), RUNTIME: { idFromName: () => "i", get: () => ({ fetch: async () => new Response("{}", { headers: { "content-type": "application/json" } }) }) }, MASTER_KEY: "2".repeat(64), INTERNAL_TOKEN: "tok-1", MODE: "commercial" };
    const call = (request: Request) => worker.fetch(request, environment as never);
    const post = (path: string, cookie: string, body: unknown) => new Request(`https://edge${path}`, { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "fetch", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

    await call(new Request("https://edge/api/health"));
    const adminHash = await pbkdf2("admin-pw-123456", "salt-a");
    db.prepare("INSERT INTO users (id, name, password_salt, password_hash, role, status, quota_usd_remaining, quota_usd_used, created_at, updated_at) VALUES ('boss', 'boss', 'salt-a', ?, 'admin', 'active', 0, 0, 't', 't')").run(adminHash);
    const adminLogin = await call(post("/api/auth/login", "", { name: "boss", password: "admin-pw-123456" }));
    const adminCookie = (adminLogin.headers.get("set-cookie") ?? "").split(";")[0]!;
    const invites = await call(post("/api/admin/invite-codes", adminCookie, { count: 1, grantedUsd: 5 }));
    const inviteCode = ((await invites.json()) as { codes: string[] }).codes[0]!;
    const register = await call(post("/api/auth/register", "", { name: "writer", password: "writer-pw-123456", inviteCode }));
    const writerCookie = (register.headers.get("set-cookie") ?? "").split(";")[0]!;
    const imported = await call(post("/api/import", writerCookie, { title: "自动之书", text: "第1章 开端\n\n正文。" }));
    const bookId = ((await imported.json()) as { bookId: string }).bookId;
    await call(post("/api/channels", writerCookie, { name: "渠道", provider: "openai", baseUrl: "https://upstream.example.com/v1", apiKey: "sk-auto-secret-123456", models: ["deepseek-chat"] }));

    let reviewCount = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (request.url.includes("upstream.example.com")) {
        const payload = JSON.parse(await request.text()) as { messages: Array<{ role: string; content: string }> };
        const system = payload.messages[0]?.content ?? "";
        if (system.includes("策划")) {
          return new Response(sseBody([
            'data: {"choices":[{"delta":{"content":"第 1 章｜启程\\n- 主角出发\\n- 遇见向导"}}]}\n\n',
            'data: {"usage":{"prompt_tokens":100,"completion_tokens":50}}\n\n',
            "data: [DONE]\n\n",
          ]), { status: 200, headers: { "content-type": "text/event-stream" } });
        }
        if (system.includes("记录员")) {
          return new Response(sseBody([
            'data: {"choices":[{"delta":{"content":"主角出发并遇见向导。"}}]}\n\n',
            'data: {"usage":{"prompt_tokens":90,"completion_tokens":40}}\n\n',
            "data: [DONE]\n\n",
          ]), { status: 200, headers: { "content-type": "text/event-stream" } });
        }
        if (system.includes("编辑")) {
          reviewCount += 1;
          const verdict = reviewCount === 1
            ? '{\\"score\\": 70, \\"verdict\\": \\"节奏过快\\", \\"issues\\": [{\\"chapter\\": 1, \\"severity\\": \\"high\\", \\"note\\": \\"出发动机不足\\"}], \\"suggestions\\": [\\"补充动机\\"]}'
            : '{\\"score\\": 92, \\"verdict\\": \\"弧线完整\\", \\"issues\\": [], \\"suggestions\\": []}';
          return new Response(sseBody([
            `data: {"choices":[{"delta":{"content":"${verdict}"}}]}\n\n`,
            'data: {"usage":{"prompt_tokens":300,"completion_tokens":100}}\n\n',
            "data: [DONE]\n\n",
          ]), { status: 200, headers: { "content-type": "text/event-stream" } });
        }
        // 写手 / 改稿人
        const rewritten = system.includes("改稿人");
        const content = rewritten ? "重写后的启程：他为了寻找父亲踏上旅途。" : "他出发了。";
        return new Response(sseBody([
          `data: {"choices":[{"delta":{"content":"${content}"}}]}\n\n`,
          'data: {"usage":{"prompt_tokens":200,"completion_tokens":80}}\n\n',
          "data: [DONE]\n\n",
        ]), { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return originalFetch(request);
    }) as typeof fetch;

    const autopilot = await call(post("/api/autopilot", writerCookie, { bookId, premise: "旅途冒险", chapters: 1, scoreThreshold: 85, maxRewrites: 1 }));
    expect(autopilot.status).toBe(200);
    const text = await readAll(autopilot.body as ReadableStream<Uint8Array>);
    expect(text).toContain("event: plan");
    expect(text).toContain("event: review");
    expect(text).toContain('"score":70');
    expect(text).toContain("event: rewrite");
    expect(text).toContain('"score":92');
    expect(text).toContain('"passed":true');

    // 重写后章节内容落盘
    const chapter = db.prepare("SELECT content FROM kv_files WHERE path = ?").get(`books/${bookId}/chapters/01.md`) as { content: string };
    expect(chapter.content).toContain("重写后的启程");

    // 结算：agent=autopilot 单条账本
    const ledger = db.prepare("SELECT * FROM usage_ledger WHERE agent = 'autopilot'").all() as Array<{ tokens_in: number; cost_usd: number }>;
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.tokens_in).toBeGreaterThan(0);
    expect(ledger[0]!.cost_usd).toBeGreaterThan(0);
    expect(reviewCount).toBe(2);
  });

  it("passes immediately when first review meets threshold", async () => {
    resetWorkerCache();
    const db = new Database(":memory:");
    const environment = { DB: d1(db), RUNTIME: { idFromName: () => "i", get: () => ({ fetch: async () => new Response("{}", { headers: { "content-type": "application/json" } }) }) }, MASTER_KEY: "3".repeat(64), INTERNAL_TOKEN: "tok-1", MODE: "selfhost" };
    const call = (request: Request) => worker.fetch(request, environment as never);
    const post = (path: string, cookie: string, body: unknown) => new Request(`https://edge${path}`, { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "fetch", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

    const setup = await call(post("/api/auth/setup", "", { name: "admin", password: "test-password-1" }));
    const cookie = (setup.headers.get("set-cookie") ?? "").split(";")[0]!;
    const imported = await call(post("/api/import", cookie, { title: "直通之书", text: "第1章 开端\n\n正文。" }));
    const bookId = ((await imported.json()) as { bookId: string }).bookId;
    await call(post("/api/channels", cookie, { name: "渠道", provider: "openai", baseUrl: "https://upstream.example.com/v1", apiKey: "sk-pass-secret-123456", models: ["m1"] }));

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (request.url.includes("upstream.example.com")) {
        const payload = JSON.parse(await request.text()) as { messages: Array<{ role: string; content: string }> };
        const system = payload.messages[0]?.content ?? "";
        let content = "内容。";
        if (system.includes("策划")) content = "第 1 章｜成稿\\n- 完成";
        else if (system.includes("编辑")) content = '{\\"score\\": 90, \\"verdict\\": \\"通过\\", \\"issues\\": [], \\"suggestions\\": []}';
        return new Response(sseBody([
          `data: {"choices":[{"delta":{"content":"${content}"}}]}\n\n`,
          "data: [DONE]\n\n",
        ]), { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return originalFetch(request);
    }) as typeof fetch;

    const autopilot = await call(post("/api/autopilot", cookie, { bookId, premise: "一次通过", chapters: 1 }));
    const text = await readAll(autopilot.body as ReadableStream<Uint8Array>);
    expect(text).toContain("event: review");
    expect(text).toContain('"passed":true');
    expect(text).not.toContain("event: rewrite");
  });
});

async function pbkdf2(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 100_000 }, key, 512);
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
