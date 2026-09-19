import { describe, expect, it } from "vitest";
import { charCardToEntity, parseCharacterCard } from "./charcard.js";
import { crc32 } from "./charcard_crc.js";

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = crc32(Buffer.concat([Buffer.from(type, "latin1"), data]));
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([head, data, tail]);
}

function makeCardPng(charaJson: string): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = chunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]));
  const text = chunk("tEXt", Buffer.concat([Buffer.from("chara\0", "latin1"), Buffer.from(Buffer.from(charaJson, "utf8").toString("base64"), "latin1")]));
  const iend = chunk("IEND", Buffer.alloc(0));
  return Buffer.concat([signature, ihdr, text, iend]);
}

const V2 = JSON.stringify({ spec: "chara_card_v2", spec_version: "2.0", data: { name: "沈砚", description: "雨夜书局的年轻掌柜", personality: "冷静、记性极佳", scenario: "民国江南小城", first_mes: "“这么晚还来？”", mes_example: "<START>{{user}}: 你是谁？{{char}}: 沈砚。", tags: ["掌柜", "阿砚"], creator_notes: "测试卡" } });

describe("charcard 角色卡", () => {
  it("parses a v2 card embedded in png tEXt chunk", () => {
    const card = parseCharacterCard(new Uint8Array(makeCardPng(V2)));
    expect(card.name).toBe("沈砚");
    expect(card.personality).toContain("冷静");
    expect(card.tags).toEqual(["掌柜", "阿砚"]);
  });

  it("maps card fields into an entity", () => {
    const card = parseCharacterCard(new Uint8Array(makeCardPng(V2)));
    const entity = charCardToEntity(card);
    expect(entity.type).toBe("character");
    expect(entity.name).toBe("沈砚");
    expect(entity.aliases).toContain("掌柜");
    expect(entity.description).toContain("性格：冷静");
    expect(entity.description).toContain("开场白：");
    expect(entity.relations).toEqual([]);
  });

  it("rejects non-png bytes and png without card data", () => {
    expect(() => parseCharacterCard(new Uint8Array(Buffer.from("not a png")))).toThrow("PNG");
    const empty = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])), chunk("IEND", Buffer.alloc(0))]);
    expect(() => parseCharacterCard(new Uint8Array(empty))).toThrow("chara/ccv3");
  });

  it("rejects card json missing a name", () => {
    const bad = makeCardPng(JSON.stringify({ data: { description: "无名" } }));
    expect(() => parseCharacterCard(new Uint8Array(bad))).toThrow("name");
  });
});
