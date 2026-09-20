import { describe, expect, it, afterEach } from "vitest";
import Database from "better-sqlite3";
import worker, { resetWorkerCache } from "../../worker/index.js";
import { parsePlan } from "../../worker/index.js";

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

function recordingHub(events: Array<{ event: string; data: unknown }>): unknown {
  return {
    idFromName: () => "stub-id",
    get: () => ({
      fetch: async (request: Request) => {
        const body = await request.json().catch(() => ({}) as Record<string, unknown>);
        events.push({ event: String(body.event ?? ""), data: body.data });
        return new Response("{}", { headers: { "content-type": "application/json" } });
      },
    }),
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

describe("worker compose pipeline", () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("parses plan lines with titles and outlines", () => {
    const plan = parsePlan([
      "第 1 章｜雨夜",
      "- 他推开门",
      "- 钟声响起",
      "第 2 章｜追猎",
      "- 黑影扑下",
    ].join("\n"), 3);
    expect(plan).toHaveLength(2);
    expect(plan[0]).toEqual({ chapter: 1, title: "雨夜", outline: "- 他推开门\n- 钟声响起" });
    expect(plan[1]!.chapter).toBe(2);
  });

  it("runs plan-then-chapters pipeline writing chapters, progress, outline and billing", async () => {
    resetWorkerCache();
    const db = new Database(":memory:");
    const hubEvents: Array<{ event: string; data: unknown }> = [];
    const environment = { DB: d1(db), RUNTIME: recordingHub(hubEvents), MASTER_KEY: "d".repeat(64), INTERNAL_TOKEN: "tok-1", MODE: "commercial" };
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
    const imported = await call(post("/api/import", writerCookie, { title: "流水线之书", text: "第1章 开端\n\n正文。" }));
    const bookId = ((await imported.json()) as { bookId: string }).bookId;
    await call(post("/api/channels", writerCookie, { name: "自有", provider: "openai", baseUrl: "https://upstream.example.com/v1", apiKey: "sk-compose-secret-12345", models: ["deepseek-chat"] }));

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (request.url.includes("upstream.example.com")) {
        const payload = JSON.parse(await request.text()) as { messages: Array<{ role: string; content: string }> };
        const system = payload.messages[0]?.content ?? "";
        if (system.includes("策划")) {
          return new Response(sseBody([
            'data: {"choices":[{"delta":{"content":"第 1 章｜雨夜\\n- 他推开门\\n- 钟声响起\\n第 2 章｜追猎\\n- 黑影扑下"}}]}\n\n',
            'data: {"usage":{"prompt_tokens":500,"completion_tokens":200}}\n\n',
            "data: [DONE]\n\n",
          ]), { status: 200, headers: { "content-type": "text/event-stream" } });
        }
        return new Response(sseBody([
          'data: {"choices":[{"delta":{"content":"他推开门，雨声灌进来。"}}]}\n\n',
          'data: {"usage":{"prompt_tokens":800,"completion_tokens":300}}\n\n',
          "data: [DONE]\n\n",
        ]), { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return originalFetch(request);
    }) as typeof fetch;

    const compose = await call(post("/api/compose", writerCookie, { bookId, premise: "雨夜钟楼的悬疑故事", chapters: 2, wordsPerChapter: 500 }));
    expect(compose.status).toBe(200);
    const text = await readAll(compose.body as ReadableStream<Uint8Array>);
    expect(text).toContain("event: plan");
    expect(text).toContain("雨夜");
    expect(text).toContain("event: delta");
    expect(text).toContain("event: done");

    // 章节正文落库（两章）
    const chapter1 = db.prepare("SELECT content FROM kv_files WHERE path = ?").get(`books/${bookId}/chapters/01.md`) as { content: string };
    const chapter2 = db.prepare("SELECT content FROM kv_files WHERE path = ?").get(`books/${bookId}/chapters/02.md`) as { content: string };
    expect(chapter1.content).toContain("# 雨夜");
    expect(chapter2.content).toContain("雨声灌进来");

    // 进度合并（导入的第 1 章 + 流水线的 1、2 章）
    const progress = JSON.parse((db.prepare("SELECT content FROM kv_files WHERE path = ?").get(`books/${bookId}/meta/progress.json`) as { content: string }).content) as { completed_chapters: number[]; total_word_count: number };
    expect(progress.completed_chapters).toEqual([1, 2]);
    expect(progress.total_word_count).toBeGreaterThan(0);

    // 大纲登记
    const outline = JSON.parse((db.prepare("SELECT content FROM kv_files WHERE path = ?").get(`books/${bookId}/meta/outline.json`) as { content: string }).content) as Array<{ chapter: number; title: string }>;
    expect(outline.map((entry) => entry.title)).toEqual(["雨夜", "追猎"]);

    // 商用结算：一次 compose 账本（plan + 2 章 + 2 次章末摘要 usage 合并）
    const ledger = db.prepare("SELECT * FROM usage_ledger WHERE agent = 'compose'").all() as Array<{ tokens_in: number; tokens_out: number; cost_usd: number }>;
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.tokens_in).toBeGreaterThan(2100);
    expect(ledger[0]!.tokens_out).toBeGreaterThan(800);
    expect(ledger[0]!.cost_usd).toBeGreaterThan(0);

    // 枢纽收到策划/章节事件
    const messages = hubEvents.filter((event) => event.event === "runtime").map((event) => (event.data as { message?: string }).message ?? "");
    expect(messages.some((message) => message.includes("策划开始"))).toBe(true);
    expect(messages.some((message) => message.includes("流水线完成"))).toBe(true);
  });

  it("rejects compose when plan output is unparseable", async () => {
    resetWorkerCache();
    const db = new Database(":memory:");
    const environment = { DB: d1(db), RUNTIME: recordingHub([]), MASTER_KEY: "e".repeat(64), INTERNAL_TOKEN: "tok-1", MODE: "selfhost" };
    const call = (request: Request) => worker.fetch(request, environment as never);
    const post = (path: string, cookie: string, body: unknown) => new Request(`https://edge${path}`, { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "fetch", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

    const setup = await call(post("/api/auth/setup", "", { name: "admin", password: "test-password-1" }));
    const cookie = (setup.headers.get("set-cookie") ?? "").split(";")[0]!;
    const imported = await call(post("/api/import", cookie, { title: "解析失败", text: "第1章 开端\n\n正文。" }));
    const bookId = ((await imported.json()) as { bookId: string }).bookId;
    await call(post("/api/channels", cookie, { name: "渠道", provider: "openai", baseUrl: "https://upstream.example.com/v1", apiKey: "sk-x-1234567890", models: ["m1"] }));

    globalThis.fetch = (async () => new Response(sseBody([
      'data: {"choices":[{"delta":{"content":"抱歉我无法输出计划"}}]}\n\n',
      "data: [DONE]\n\n",
    ]), { status: 200, headers: { "content-type": "text/event-stream" } })) as typeof fetch;

    const compose = await call(post("/api/compose", cookie, { bookId, premise: "任意" }));
    expect(compose.status).toBe(502);
  });
});

async function pbkdf2(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 100_000 }, key, 512);
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
