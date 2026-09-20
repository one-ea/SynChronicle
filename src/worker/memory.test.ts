import { describe, expect, it, afterEach } from "vitest";
import Database from "better-sqlite3";
import worker, { resetWorkerCache } from "../../worker/index.js";
import { buildChapterContext, renderMemoryBlock } from "../../worker/memory.js";
import type { KvBackend } from "../../worker/types.js";

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

/** 内存 KvBackend：Map 实现 kv_files 语义。 */
function memoryKv(): KvBackend & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key) => store.get(key) ?? null,
    set: async (key, value) => { store.set(key, value); },
    delete: async (key) => { store.delete(key); },
    list: async (prefix) => [...store.keys()].filter((key) => key.startsWith(prefix)).sort(),
  };
}

describe("edge memory", () => {
  afterEach(() => { globalThis.fetch = originalFetch; });
  const originalFetch = globalThis.fetch;

  it("builds chapter context: ranked summaries, previous ending, characters, foreshadows", async () => {
    const kv = memoryKv();
    kv.store.set("books/b1/summaries/01.json", JSON.stringify({ chapter: 1, summary: "沈砚在书局发现了残卷" }));
    kv.store.set("books/b1/summaries/02.json", JSON.stringify({ chapter: 2, summary: "夜里钟楼传来异响" }));
    kv.store.set("books/b1/chapters/02.md", "# 追猎\n\n" + "雨声不断。".repeat(80));
    kv.store.set("books/b1/meta/entities.json", JSON.stringify([
      { id: "shen", name: "沈砚", type: "character", aliases: ["阿砚"], description: "书局掌柜，记性超群", relations: [], states: [{ chapter: 2, mood: "警觉", goals: ["查明残卷来历"] }] },
      { id: "bell", name: "古钟", type: "item", description: "钟楼古物" },
      { id: "lin", name: "林捕头", type: "character", description: "追查连环失窃", relations: [], states: [] },
    ]));
    kv.store.set("books/b1/meta/foreshadows.json", JSON.stringify({ items: [
      { id: "f1", title: "残卷缺页", description: "缺的那一页去哪了", type: "mystery", stage: "planted", plantedChapter: 1, urgency: "high", missedRecoveries: 0 },
      { id: "f2", title: "已解之谜", description: "已收束", type: "mystery", stage: "resolved", plantedChapter: 1, urgency: "low", resolvedChapter: 2, missedRecoveries: 0 },
    ] }));

    const bundle = await buildChapterContext(kv, "b1", 3, "钟楼 残卷 沈砚");
    expect(bundle.summaries.length).toBe(2);
    expect(bundle.summaries[0]!.score).toBeGreaterThanOrEqual(bundle.summaries[1]!.score);
    expect(bundle.summaries.map((item) => item.chapter).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(bundle.previousEnding).toContain("雨声不断。");
    expect(bundle.characters.map((character) => character.name)).toContain("沈砚");
    expect(bundle.characters.find((character) => character.name === "沈砚")?.mood).toBe("警觉");
    expect(bundle.openForeshadows).toHaveLength(1);
    expect(bundle.openForeshadows[0]!.title).toBe("残卷缺页");

    const block = renderMemoryBlock(bundle);
    expect(block).toContain("【前文回顾】");
    expect(block).toContain("【上一章结尾】");
    expect(block).toContain("【登场角色】");
    expect(block).toContain("【未回收伏笔】");
    expect(block).toContain("警觉");
  });

  it("empty book yields empty memory block", async () => {
    const bundle = await buildChapterContext(memoryKv(), "none", 1, "任意");
    expect(renderMemoryBlock(bundle)).toBe("");
  });
});

describe("entities and foreshadows api", () => {
  it("upserts and lists via worker routes with ownership guard", async () => {
    resetWorkerCache();
    const db = new Database(":memory:");
    const environment = { DB: d1(db), RUNTIME: { idFromName: () => "i", get: () => ({ fetch: async () => new Response("{}", { headers: { "content-type": "application/json" } }) }) }, MASTER_KEY: "f".repeat(64), INTERNAL_TOKEN: "tok-1", MODE: "selfhost" };
    const call = (request: Request) => worker.fetch(request, environment as never);
    const post = (path: string, cookie: string, body: unknown) => new Request(`https://edge${path}`, { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "fetch", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

    const setup = await call(post("/api/auth/setup", "", { name: "admin", password: "test-password-1" }));
    const cookie = (setup.headers.get("set-cookie") ?? "").split(";")[0]!;
    const imported = await call(post("/api/import", cookie, { title: "记忆之书", text: "第1章 开端\n\n正文。" }));
    const bookId = ((await imported.json()) as { bookId: string }).bookId;

    const entity = await call(post("/api/entities", cookie, { bookId, entity: { id: "shen", name: "沈砚", type: "character", aliases: ["阿砚"], description: "书局掌柜", mood: "平静", goals: ["守秘密"], chapter: 1 } }));
    expect(entity.status).toBe(201);
    const again = await call(post("/api/entities", cookie, { bookId, entity: { id: "shen", name: "沈砚", type: "character", description: "书局掌柜，心中有鬼", mood: "不安", goals: ["销毁证据"], chapter: 2 } }));
    expect(again.status).toBe(201);

    const list = await call(new Request(`https://edge/api/entities?book=${bookId}`, { headers: { cookie } }));
    const listBody = await list.json() as { entities: Array<{ id: string; states: Array<{ mood: string }> }> };
    expect(listBody.entities).toHaveLength(1);
    expect(listBody.entities[0]!.states).toHaveLength(2);
    expect(listBody.entities[0]!.states[1]!.mood).toBe("不安");

    const foreshadow = await call(post("/api/foreshadows", cookie, { bookId, foreshadow: { id: "f1", title: "残卷缺页", description: "缺页去向", plantedChapter: 1, urgency: "high" } }));
    expect(foreshadow.status).toBe(201);
    const fList = await call(new Request(`https://edge/api/foreshadows?book=${bookId}`, { headers: { cookie } }));
    const fBody = await fList.json() as { items: Array<{ id: string; stage: string }> };
    expect(fBody.items[0]!.id).toBe("f1");
    expect(fBody.items[0]!.stage).toBe("planted");
  });
});

describe("compose with memory injection", () => {
  it("chapter two system prompt contains chapter one memory", async () => {
    resetWorkerCache();
    const db = new Database(":memory:");
    const environment = { DB: d1(db), RUNTIME: { idFromName: () => "i", get: () => ({ fetch: async () => new Response("{}", { headers: { "content-type": "application/json" } }) }) }, MASTER_KEY: "0".repeat(64), INTERNAL_TOKEN: "tok-1", MODE: "selfhost" };
    const call = (request: Request) => worker.fetch(request, environment as never);
    const post = (path: string, cookie: string, body: unknown) => new Request(`https://edge${path}`, { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "fetch", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

    const setup = await call(post("/api/auth/setup", "", { name: "admin", password: "test-password-1" }));
    const cookie = (setup.headers.get("set-cookie") ?? "").split(";")[0]!;
    const imported = await call(post("/api/import", cookie, { title: "连续之书", text: "第1章 开端\n\n正文一。" }));
    const bookId = ((await imported.json()) as { bookId: string }).bookId;
    await call(post("/api/channels", cookie, { name: "渠道", provider: "openai", baseUrl: "https://upstream.example.com/v1", apiKey: "sk-mem-secret-123456", models: ["m1"] }));
    await call(post("/api/entities", cookie, { bookId, entity: { id: "shen", name: "沈砚", type: "character", description: "书局掌柜", mood: "警觉", chapter: 1 } }));
    await call(post("/api/foreshadows", cookie, { bookId, foreshadow: { id: "f1", title: "残卷缺页", description: "缺页去向成谜", plantedChapter: 1, urgency: "high" } }));

    const systemPrompts: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (request.url.includes("upstream.example.com")) {
        const payload = JSON.parse(await request.text()) as { messages: Array<{ role: string; content: string }> };
        const system = payload.messages[0]?.content ?? "";
        if (system.includes("策划")) {
          return new Response(sseBody([
            'data: {"choices":[{"delta":{"content":"第 1 章｜开篇\\n- 沈砚出场\\n第 2 章｜深入\\n- 钟楼探秘"}}]}\n\n',
            "data: [DONE]\n\n",
          ]), { status: 200, headers: { "content-type": "text/event-stream" } });
        }
        systemPrompts.push(system);
        return new Response(sseBody([
          'data: {"choices":[{"delta":{"content":"正文段落。"}}]}\n\n',
          'data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
          "data: [DONE]\n\n",
        ]), { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return originalFetch(request);
    }) as typeof fetch;

    const compose = await call(post("/api/compose", cookie, { bookId, premise: "书局悬疑", chapters: 2 }));
    expect(compose.status).toBe(200);
    await readAll(compose.body as ReadableStream<Uint8Array>);

    // 第 2 章的 system prompt 应含记忆块：角色状态 + 未回收伏笔 + 第 1 章摘要（来自导入 summaries？导入不写摘要，本章写完后才有）
    const chapterTwoPrompt = systemPrompts[1] ?? "";
    expect(chapterTwoPrompt).toContain("【登场角色】");
    expect(chapterTwoPrompt).toContain("沈砚");
    expect(chapterTwoPrompt).toContain("【未回收伏笔】");
    expect(chapterTwoPrompt).toContain("残卷缺页");
  });
});

function sseBody(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({ start(controller) { for (const line of lines) controller.enqueue(encoder.encode(line)); controller.close(); } });
}

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
