/**
 * 节点脑暴（specs/2026-09-19-p5-creation-workbench R2）。
 * 前缀/核心/后缀三层词典组合生成命名要素；mulberry32 PRNG 保证同种子复现。零模型依赖。
 */

export type BrainstormType = "sect" | "skill" | "place" | "name" | "faction" | "item" | "title" | "hook";

export const BRAINSTORM_TYPES: BrainstormType[] = ["sect", "skill", "place", "name", "faction", "item", "title", "hook"];

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, pool: readonly T[]): T {
  return pool[Math.floor(random() * pool.length)]!;
}

function sample<T>(random: () => number, pool: readonly T[], count: number): T[] {
  const out: T[] = [];
  const seen = new Set<T>();
  let guard = 0;
  while (out.length < count && guard < count * 40) {
    guard += 1;
    const value = pick(random, pool);
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

const SECT_PREFIX = ["玄", "苍", "青", "紫", "赤", "白", "墨", "凌", "太", "镇", "御", "天"];
const SECT_CORE = ["天", "雷", "幽", "剑", "丹", "星", "月", "龙", "凤", "岳", "渊", "霞"];
const SECT_SUFFIX = ["宗", "门", "阁", "山庄", "谷", "教", "派", "寺"];

const SKILL_CORE = ["九霄", "破军", "寒霜", "烈焰", "惊鸿", "踏月", "裂空", "无量", "天罡", "万象", "青莲", "噬星"];
const SKILL_SUFFIX = ["诀", "剑法", "掌", "指", "步", "刀法", "真经", "拳", "身法", "神通"];

const PLACE_PREFIX = ["落霞", "断云", "寒潭", "孤山", "迷雾", "青石", "听雨", "望北", "沉星", "枯藤"];
const PLACE_SUFFIX = ["镇", "城", "涧", "崖", "渡", "岭", "湖", "坊市", "古道", "峰"];

const NAME_SURNAME = ["沈", "苏", "顾", "林", "陆", "秦", "江", "叶", "楚", "萧", "宋", "裴"];
const NAME_MALE = ["砚", "行舟", "既明", "无咎", "长歌", "怀瑾", "承影", "望舒", "惊蛰", "拾遗"];
const NAME_FEMALE = ["晚", "疏影", "青梧", "阿蘅", "照君", "未央", "采薇", "栖迟", "南絮", "清越"];

const FACTION_PREFIX = ["黑水", "赤旗", "夜枭", "血屠", "铁面", "灰烬", "七杀", "断刃"];
const FACTION_SUFFIX = ["司", "盟", "卫", "堂", "楼", "会", "阁"];

const ITEM_CORE = ["噬魂", "镇岳", "引雷", "定风", "碎星", "照影", "缚龙", "断水", "焚天", "沉璧"];
const ITEM_SUFFIX = ["剑", "环", "镜", "铃", "印", "扇", "枪", "玉佩", "灯", "令牌"];

const TITLE_PREFIX = ["我在", "开局", "满级", "长夜", "执剑", "执灯", "逐月", "镇北", "山河", "人间"];
const TITLE_CORE = ["雨夜书局", "旧钟楼", "断案手记", "养鬼手记", "捉刀人", "炼气士", "守灯人", "行医手记"];
const TITLE_SUFFIX = ["的那些年", "实录", "从零开始", "指南", "手札", ""];

const HOOK_TEMPLATES = [
  "他推开门，屋里坐着的竟是十年前应该死了的那个人。",
  "“这笔账，得从你父亲的死说起。”来人把一枚铜钥匙放在桌上。",
  "钟楼的钟第三次响起时，全城的人都停下了手里的活。",
  "他数了数桌上的茶杯——四个人喝茶，屋里只坐了三个人。",
  "“签了它，你就能活。”纸上的名字，赫然是他自己的。",
  "婚礼当夜，花轿里抬出来的却是一口薄棺。",
];

const COMPOUND: Record<Exclude<BrainstormType, "name" | "hook">, (random: () => number) => string> = {
  sect: (r) => pick(r, SECT_PREFIX) + pick(r, SECT_CORE) + pick(r, SECT_SUFFIX),
  skill: (r) => pick(r, SKILL_CORE) + pick(r, SKILL_SUFFIX),
  place: (r) => pick(r, PLACE_PREFIX) + pick(r, PLACE_SUFFIX),
  faction: (r) => pick(r, FACTION_PREFIX) + pick(r, FACTION_SUFFIX),
  item: (r) => pick(r, ITEM_CORE) + pick(r, ITEM_SUFFIX),
  title: (r) => pick(r, TITLE_PREFIX) + pick(r, TITLE_CORE) + pick(r, TITLE_SUFFIX),
};

export function brainstorm(type: BrainstormType, count = 8, seed = Date.now()): string[] {
  const valid = count > 0 && Math.floor(count) === count;
  if (!valid || !BRAINSTORM_TYPES.includes(type)) return [];
  const random = mulberry32(seed);
  if (type === "hook") return sample(random, HOOK_TEMPLATES, count);
  if (type === "name") {
    const out: string[] = [];
    const seen = new Set<string>();
    let guard = 0;
    while (out.length < count && guard < count * 60) {
      guard += 1;
      const name = pick(random, NAME_SURNAME) + pick(random, random() > 0.5 ? NAME_MALE : NAME_FEMALE);
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
    return out;
  }
  return sampleCompound(random, type, count);
}

function sampleCompound(random: () => number, type: Exclude<BrainstormType, "name" | "hook">, count: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let guard = 0;
  while (out.length < count && guard < count * 60) {
    guard += 1;
    const value = COMPOUND[type](random);
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
