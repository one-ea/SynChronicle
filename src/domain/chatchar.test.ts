import { describe, expect, it } from "vitest";
import { buildCharacterPrompt, characterReply, type ChatTurn } from "./chatchar.js";
import type { Entity } from "./entity.js";

const entity: Entity = {
  id: "shen-yan",
  name: "沈砚",
  type: "character",
  aliases: ["阿砚"],
  description: "雨夜书局的年轻掌柜，记忆力异于常人",
  relations: [{ targetId: "su-wan", type: "ally", strength: 20 }],
  states: [{ chapter: 3, mood: "警觉", goals: ["查清父亲失踪的真相"], statusNote: "手握旧钟楼钥匙" }],
};

describe("chatchar 角色对话推演", () => {
  it("builds a prompt containing persona, state and relations", () => {
    const prompt = buildCharacterPrompt(entity);
    expect(prompt).toContain("角色扮演：沈砚");
    expect(prompt).toContain("雨夜书局");
    expect(prompt).toContain("查清父亲失踪的真相");
    expect(prompt).toContain("好感度 20");
    expect(prompt).toContain("第一人称");
  });

  it("returns deterministic replies containing the name", () => {
    const first = characterReply(entity, "你怎么看旧钟楼的钥匙？");
    const second = characterReply(entity, "你怎么看旧钟楼的钥匙？");
    expect(first.reply).toEqual(second.reply);
    expect(first.reply).toContain("沈砚");
    expect(first.prompt).toContain("角色扮演");
  });

  it("varies reply with history length and falls back without states", () => {
    const history: ChatTurn[] = [{ role: "user", text: "在吗" }, { role: "character", text: "在。" }];
    const withHistory = characterReply(entity, "钥匙在哪", history);
    expect(withHistory.reply.length).toBeGreaterThan(6);
    const bare: Entity = { ...entity, description: "神秘人", states: [] };
    const reply = characterReply(bare, "你是谁");
    expect(reply.reply.length).toBeGreaterThan(6);
  });

  it("throws on empty message", () => {
    expect(() => characterReply(entity, "   ")).toThrow("消息不能为空");
  });
});
