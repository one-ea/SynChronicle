import type { Entity } from "./entity.js";

/**
 * SillyTavern 角色卡互通（specs/2026-09-19-p4-competitive-parity R4）。
 * PNG tEXt(chara, base64 JSON V2) / iTXt(ccv3, JSON) 块解析，映射为实体。
 * 零依赖手写 PNG 块扫描；CRC 不校验（容错历史卡）。
 */

export interface CharacterCard {
  spec?: string;
  name: string;
  description?: string;
  personality?: string;
  scenario?: string;
  firstMes?: string;
  mesExample?: string;
  tags?: string[];
  creatorNotes?: string;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function* iterateChunks(bytes: Uint8Array): Generator<{ type: string; data: Uint8Array }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString("latin1");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    yield { type, data };
    offset += 12 + length;
    if (type === "IEND") break;
  }
}

function decodeTextChunk(data: Uint8Array): { keyword: string; value: string } | null {
  const separator = data.indexOf(0);
  if (separator <= 0) return null;
  const keyword = Buffer.from(data.subarray(0, separator)).toString("latin1");
  const value = Buffer.from(data.subarray(separator + 1)).toString("utf8");
  return { keyword, value };
}

function decodeItxtChunk(data: Uint8Array): { keyword: string; value: string } | null {
  let cursor = 0;
  const readNullTerminated = (): string => {
    const end = data.indexOf(0, cursor);
    if (end < 0) return "";
    const value = Buffer.from(data.subarray(cursor, end)).toString("latin1");
    cursor = end + 1;
    return value;
  };
  const keyword = readNullTerminated();
  const compressedFlag = data[cursor];
  cursor += 2; // compressed flag + compression method
  readNullTerminated(); // language tag
  readNullTerminated(); // translated keyword
  if (compressedFlag) return null;
  const value = Buffer.from(data.subarray(cursor)).toString("utf8");
  return { keyword, value };
}

function parseCardJson(raw: string): CharacterCard {
  const parsed = JSON.parse(raw) as Record<string, unknown> & { data?: Record<string, unknown> };
  const source = (parsed.data && typeof parsed.data === "object" ? parsed.data : parsed) as Record<string, unknown>;
  const name = typeof source.name === "string" ? source.name.trim() : "";
  if (!name) throw new Error("角色卡缺少 name 字段");
  const card: Record<string, unknown> & { name: string; tags?: string[]; spec?: string } = { name };
  for (const [key, target] of [["description", "description"], ["personality", "personality"], ["scenario", "scenario"], ["first_mes", "firstMes"], ["mes_example", "mesExample"], ["creator_notes", "creatorNotes"]] as const) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) card[target] = value.trim();
  }
  if (Array.isArray(source.tags)) card.tags = source.tags.filter((tag): tag is string => typeof tag === "string");
  if (typeof parsed.spec === "string") card.spec = parsed.spec;
  return card as CharacterCard;
}

export function parseCharacterCard(bytes: Uint8Array): CharacterCard {
  if (bytes.length < PNG_SIGNATURE.length || !Buffer.from(bytes.subarray(0, PNG_SIGNATURE.length)).equals(PNG_SIGNATURE)) {
    throw new Error("不是有效的 PNG 文件");
  }
  let rawJson: string | null = null;
  for (const chunk of iterateChunks(bytes)) {
    if (chunk.type === "tEXt") {
      const entry = decodeTextChunk(chunk.data);
      if (entry?.keyword === "chara") rawJson = Buffer.from(entry.value, "base64").toString("utf8");
    } else if (chunk.type === "iTXt") {
      const entry = decodeItxtChunk(chunk.data);
      if (entry?.keyword === "ccv3") rawJson = entry.value;
    }
  }
  if (!rawJson) throw new Error("PNG 中未找到角色数据块（chara/ccv3）");
  return parseCardJson(rawJson);
}

export function charCardToEntity(card: CharacterCard): Entity {
  const sections: string[] = [];
  if (card.description) sections.push(card.description);
  if (card.personality) sections.push(`性格：${card.personality}`);
  if (card.scenario) sections.push(`场景：${card.scenario}`);
  if (card.firstMes) sections.push(`开场白：${card.firstMes}`);
  if (card.mesExample) sections.push(`对话示例：${card.mesExample}`);
  if (card.creatorNotes) sections.push(`创作者注：${card.creatorNotes}`);
  const known = new Set([card.name]);
  const aliases = (card.tags ?? []).filter((tag) => tag.trim() && !known.has(tag) && known.add(tag));
  return {
    id: `card-${card.name.replace(/\s+/g, "-").toLowerCase()}`,
    name: card.name,
    type: "character",
    aliases,
    description: sections.join("\n") || "（角色卡未提供描述）",
    relations: [],
    states: [],
  };
}
