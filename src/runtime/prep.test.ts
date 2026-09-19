import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../store/index.js";
import { PrepRunner } from "./prep.js";

describe("PrepRunner", () => {
  it("persists every message, keeps AI ready advisory, and confirms only by user action", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prep-runner-"));
    const store = new Store(dir);
    await store.init();
    const outputs = ["<reply>先定主角。</reply><suggestions>失忆剑客\n落魄掌柜</suggestions><ready>true</ready>", "<brief>沈砚经营雨夜书局，必须用记忆支付能力代价，对抗夺书人。</brief>"];
    const host = { chat: async () => outputs.shift() ?? "" };
    const runner = new PrepRunner(host, store);
    const created = await runner.createSession("book-1", "雨夜书局");
    const turn = await runner.chat(created.id, "我想写东方奇幻");
    expect(turn.session.status).toBe("active");
    expect(turn.session.stage).toBe("intent");
    expect(turn.reply.suggestions).toEqual(["失忆剑客", "落魄掌柜"]);
    expect((await readFile(join(dir, "meta/sessions/prep.jsonl"), "utf8")).trim().split("\n")).toHaveLength(2);
    let session = turn.session;
    for (let index = 0; index < 4; index += 1) session = await runner.advance(session.id);
    expect(session.stage).toBe("ready");
    const confirmed = await runner.confirm(session.id);
    expect(confirmed.brief).toContain("沈砚");
    expect((await store.outline.loadPremise())).toContain("雨夜书局");
    expect((await store.constitution.load())?.worldRules).toContain("沈砚经营雨夜书局，必须用记忆支付能力代价，对抗夺书人");
  });

  it("rejects confirmation before ready and locks ended sessions", async () => {
    const store = new Store(await mkdtemp(join(tmpdir(), "prep-state-")));
    await store.init();
    const runner = new PrepRunner({ chat: async () => "<reply>继续</reply>" }, store);
    const session = await runner.createSession("book-1");
    await expect(runner.confirm(session.id)).rejects.toThrow("ready");
    await runner.abandon(session.id);
    await expect(runner.chat(session.id, "继续")).rejects.toThrow("结束");
  });
});
