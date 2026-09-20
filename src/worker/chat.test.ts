import { describe, expect, it, afterEach } from "vitest";
import Database from "better-sqlite3";
import worker, { resetWorkerCache } from "../../worker/index.js";
import { parseUpstreamStream, settleCost } from "../../worker/chat.js";

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

/** 记录型 RuntimeHub mock：捕获推给 DO 的事件。 */
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
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
}

const UPSTREAM_OK = 200;
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

describe("worker chat engine", () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("parses upstream sse deltas and usage", async () => {
    const pieces = [];
    for await (const piece of parseUpstreamStream(sseBody([
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"，世界"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":6}}\n\n',
      "data: [DONE]\n\n",
    ]))) pieces.push(piece);
    expect(pieces.filter((piece) => piece.delta).map((piece) => piece.delta).join("")).toBe("你好，世界");
    expect(pieces.find((piece) => piece.usage)?.usage).toEqual({ input: 12, output: 6 });
  });

  it("settleCost matches price table", () => {
    const cost = settleCost("deepseek-chat", 1000, 1000);
    expect(cost).toBeCloseTo(0.00027 + 0.0011, 6);
    expect(settleCost("unknown-model", 1000, 1000)).toBe(0);
  });

  it("streams chat turns from a channel with history, hub events, and selfhost zero billing", async () => {
    resetWorkerCache();
    const db = new Database(":memory:");
    const hubEvents: Array<{ event: string; data: unknown }> = [];
    const environment = { DB: d1(db), RUNTIME: recordingHub(hubEvents), MASTER_KEY: "b".repeat(64), INTERNAL_TOKEN: "tok-1", MODE: "selfhost" };
    const call = (request: Request) => worker.fetch(request, environment as never);
    const post = (path: string, cookie: string, body: unknown) => new Request(`https://edge${path}`, { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "fetch", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

    // 管理员建书架与自有渠道
    const setup = await call(post("/api/auth/setup", "", { name: "admin", password: "test-password-1" }));
    const cookie = (setup.headers.get("set-cookie") ?? "").split(";")[0]!;
    const imported = await call(post("/api/import", cookie, { title: "对话之书", text: "第1章 开端\n\n正文。" }));
    const bookId = ((await imported.json()) as { bookId: string }).bookId;
    const channelRes = await call(post("/api/channels", cookie, { name: "测试渠道", provider: "openai", baseUrl: "https://upstream.example.com/v1", apiKey: "sk-chat-secret-123456", models: ["chat-model-x"] }));
    expect(channelRes.status).toBe(201);

    // 拦截上游调用
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (request.url.includes("upstream.example.com")) {
        expect(request.headers.get("authorization")).toBe("Bearer sk-chat-secret-123456");
        const payload = JSON.parse(await request.text()) as { model: string; stream: boolean; messages: Array<{ role: string; content: string }> };
        expect(payload.model).toBe("chat-model-x");
        expect(payload.stream).toBe(true);
        expect(payload.messages.at(-1)).toEqual({ role: "user", content: "给我一个故事点子" });
        return new Response(sseBody([
          'data: {"choices":[{"delta":{"content":"雨夜里"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"的钟楼"}}]}\n\n',
          'data: {"usage":{"prompt_tokens":40,"completion_tokens":8}}\n\n',
          "data: [DONE]\n\n",
        ]), { status: UPSTREAM_OK, headers: { "content-type": "text/event-stream" } });
      }
      return originalFetch(request);
    }) as typeof fetch;

    const chat = await call(post("/api/chat", cookie, { bookId, message: "给我一个故事点子" }));
    expect(chat.status).toBe(200);
    expect(chat.headers.get("content-type")).toContain("text/event-stream");
    const text = await readAll(chat.body as ReadableStream<Uint8Array>);
    expect(text).toContain("event: delta");
    expect(text).toContain("雨夜里");
    expect(text).toContain("event: done");

    // 历史持久化为一来一回
    const history = await call(new Request(`https://edge/api/chat?book=${bookId}`, { headers: { cookie } }));
    const historyBody = await history.json() as { turns: ChatTurnRecord[] };
    expect(historyBody.turns.map((turn) => turn.role)).toEqual(["user", "assistant"]);
    expect(historyBody.turns[1]!.content).toContain("钟楼");

    // DO 枢纽收到开始/增量/完成事件（增量按 200ms 窗口合并，断言内容完整不丢失）
    const deltaEvents = hubEvents.filter((event) => event.event === "delta") as Array<{ data: { value: string } }>;
    expect(deltaEvents.length).toBeGreaterThanOrEqual(1);
    expect(deltaEvents.map((event) => event.data.value).join("")).toContain("雨夜里的钟楼");

    // 自用模式：不写额度账本
    const ledger = db.prepare("SELECT COUNT(*) AS total FROM usage_ledger").get() as { total: number };
    expect(ledger.total).toBe(0);
  });

  it("bills commercial chat via quota settle", async () => {
    resetWorkerCache();
    const db = new Database(":memory:");
    const hubEvents: Array<{ event: string; data: unknown }> = [];
    const environment = { DB: d1(db), RUNTIME: recordingHub(hubEvents), MASTER_KEY: "c".repeat(64), INTERNAL_TOKEN: "tok-1", MODE: "commercial" };
    const call = (request: Request) => worker.fetch(request, environment as never);
    const post = (path: string, cookie: string, body: unknown) => new Request(`https://edge${path}`, { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "fetch", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

    // 商用：先触发建表，再直插管理员（带额度体系）
    await call(new Request("https://edge/api/health"));
    const adminHash = await pbkdf2("admin-pw-123456", "salt-a");
    db.prepare("INSERT INTO users (id, name, password_salt, password_hash, role, status, quota_usd_remaining, quota_usd_used, created_at, updated_at) VALUES ('boss', 'boss', 'salt-a', ?, 'admin', 'active', 0, 0, 't', 't')").run(adminHash);
    const adminLogin = await call(post("/api/auth/login", "", { name: "boss", password: "admin-pw-123456" }));
    const adminCookie = (adminLogin.headers.get("set-cookie") ?? "").split(";")[0]!;
    const invites = await call(post("/api/admin/invite-codes", adminCookie, { count: 1, grantedUsd: 1 }));
    const inviteCode = ((await invites.json()) as { codes: string[] }).codes[0]!;
    const register = await call(post("/api/auth/register", "", { name: "writer", password: "writer-pw-123456", inviteCode }));
    const writerCookie = (register.headers.get("set-cookie") ?? "").split(";")[0]!;

    const imported = await call(post("/api/import", writerCookie, { title: "计费之书", text: "第1章 开端\n\n正文。" }));
    const bookId = ((await imported.json()) as { bookId: string }).bookId;
    await call(post("/api/channels", writerCookie, { name: "自有", provider: "openai", baseUrl: "https://upstream.example.com/v1", apiKey: "sk-bill-secret-12345", models: ["deepseek-chat"] }));

    globalThis.fetch = (async () => new Response(sseBody([
      'data: {"choices":[{"delta":{"content":"答"}}]}\n\n',
      'data: {"usage":{"prompt_tokens":2000,"completion_tokens":1000}}\n\n',
      "data: [DONE]\n\n",
    ]), { status: 200, headers: { "content-type": "text/event-stream" } })) as typeof fetch;

    const chat = await call(post("/api/chat", writerCookie, { bookId, message: "写一段" }));
    expect(chat.status).toBe(200);
    await readAll(chat.body as ReadableStream<Uint8Array>);

    const ledger = db.prepare("SELECT * FROM usage_ledger").all() as Array<{ user_id: string; agent: string; tokens_in: number; tokens_out: number; cost_usd: number }>;
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.agent).toBe("chat");
    expect(ledger[0]!.tokens_in).toBe(2000);
    expect(ledger[0]!.cost_usd).toBeGreaterThan(0);
    const user = db.prepare("SELECT quota_usd_remaining, quota_usd_used FROM users WHERE name = 'writer'").get() as { quota_usd_remaining: number; quota_usd_used: number };
    expect(user.quota_usd_remaining).toBeCloseTo(1 - ledger[0]!.cost_usd, 6);
    expect(user.quota_usd_used).toBeCloseTo(ledger[0]!.cost_usd, 6);
  });
});

interface ChatTurnRecord { role: string; content: string }

async function pbkdf2(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 100_000 }, key, 512);
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
