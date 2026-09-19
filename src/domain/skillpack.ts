import { z } from "zod";

/**
 * 写作技能包领域模型（P7-3 技能包市场）。
 * 内置包随版本分发，自定义包持久化在 meta/skillpacks.json；
 * 启用的技法渲染为 [写作技法] 块，随项目宪法一起注入每轮生成。
 */

export const SkillPackSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(40),
  category: z.string().min(1).max(20),
  description: z.string().max(120).default(""),
  techniques: z.array(z.string().min(1).max(160)).min(1),
  origin: z.enum(["builtin", "custom"]).default("custom"),
});
export type SkillPack = z.infer<typeof SkillPackSchema>;

export const SkillPackFileSchema = z.object({
  enabled: z.array(z.string().min(1)).default([]),
  custom: z.array(SkillPackSchema).default([]),
  updatedAt: z.string().default(new Date().toISOString()),
});
export type SkillPackFile = z.infer<typeof SkillPackFileSchema>;

export const SKILLPACKS_PATH = "meta/skillpacks.json";

export function emptySkillPackFile(): SkillPackFile {
  return { enabled: [], custom: [], updatedAt: new Date().toISOString() };
}

export const BUILTIN_SKILL_PACKS: SkillPack[] = [
  {
    id: "golden-opening",
    name: "黄金开篇",
    category: "结构",
    description: "前三章快速建立期待感与代入感。",
    origin: "builtin",
    techniques: [
      "开篇第一段必须抛出具体冲突或反常细节，禁止环境铺陈超过两句。",
      "第一章内让主角遭遇一次明确的挫败或危机，压迫感先于金手指出现。",
      "每章结尾留一个未解之钩，钩子要指向下一章的具体事件。",
      "主角的核心渴望在前三章内说清楚，用一个可看见的行动展示。",
    ],
  },
  {
    id: "thrill-rhythm",
    name: "爽点节奏",
    category: "节奏",
    description: "期待-压抑-释放的循环编排。",
    origin: "builtin",
    techniques: [
      "每三章安排一次小爽点，每卷安排一次大爽点，爽点前必须先压抑。",
      "爽点要落在具体的旁观者反应上：震惊、失态、重新评估主角。",
      "打脸场景分三拍：轻视、交锋、反转，反转后补一拍余韵。",
      "禁止连续两章无冲突推进，过渡章也要埋一个小张力。",
    ],
  },
  {
    id: "dialogue-subtext",
    name: "对话潜台词",
    category: "文笔",
    description: "让人物说有意思的话。",
    origin: "builtin",
    techniques: [
      "关键对话中人物不得直接说出真实意图，用回避、反问或转移话题代替。",
      "每场对话至少一次答非所问，用来暴露人物心事。",
      "对话标签以动作代替说话动词，用小动作打断长对白。",
      "两人以上对话时，让每人保持可辨识的语言习惯或口癖。",
    ],
  },
  {
    id: "sensory-scene",
    name: "五感场景",
    category: "文笔",
    description: "用感官细节替代总结性描写。",
    origin: "builtin",
    techniques: [
      "每个新场景至少调用三种感官（视觉之外必占其一）。",
      "禁止用『气氛十分紧张』类总结句，改用可观察的身体反应或环境细节。",
      "环境描写每次不超过两句，必须与人物当下情绪发生化学反应。",
      "重要道具出场时给出一个可触摸的质感细节。",
    ],
  },
  {
    id: "combat-storyboard",
    name: "战斗分镜",
    category: "场面",
    description: "把战斗写成镜头语言。",
    origin: "builtin",
    techniques: [
      "战斗按回合分镜：每拍只写一个攻防动作及其直接后果。",
      "战斗中插入一次环境破坏或旁观者避险，用来标定力量层级。",
      "胜负手必须呼应此前埋下的能力、道具或地形伏笔。",
      "战斗结束后写一拍静默的代价：伤势、喘息、破碎的物件。",
    ],
  },
  {
    id: "suspense-ending",
    name: "悬念结尾",
    category: "结构",
    description: "章末钩子的变奏库。",
    origin: "builtin",
    techniques: [
      "章末钩子轮换类型：危机型、揭示型、决定型、反转型，避免连续同型。",
      "揭示型钩子只揭示一半，另一半留作下章开篇的第一拍。",
      "章末最后一句控制在十五字以内，短句收力。",
      "每五章安排一次假结尾：看似平静的日常里埋一个错位细节。",
    ],
  },
  {
    id: "foreshadow-craft",
    name: "伏笔铺设",
    category: "结构",
    description: "契诃夫之枪的埋设与回收。",
    origin: "builtin",
    techniques: [
      "重要伏笔出场时降格写成闲笔，藏在动作或对话里而非单独成段。",
      "每个伏笔登记到伏笔看板，注明计划回收章节与错过次数。",
      "回收伏笔时让读者能回想起埋设场景，点一句即可，禁止长篇解释。",
      "长线伏笔每十章至少轻触一次，保持读者的潜意识在线。",
    ],
  },
  {
    id: "emotion-curve",
    name: "情绪曲线",
    category: "节奏",
    description: "章节内部的情绪起伏设计。",
    origin: "builtin",
    techniques: [
      "每章先定情绪基调，再排情绪节拍：起点、压低、抬升、收点。",
      "高潮前安排一次情绪喘息，用小温暖或小幽默垫场。",
      "悲伤场景克制煽情：写动作和物件，禁止直接写哭。",
      "章内情绪转折不超过两次，转折点放在章节六成处。",
    ],
  },
];

/** 渲染启用的技法为注入块；无启用包时返回空串。 */
export function renderSkillPacks(packs: SkillPack[]): string {
  if (!packs.length) return "";
  const lines: string[] = ["[写作技法]"];
  for (const pack of packs) {
    lines.push(`# ${pack.name}`);
    for (const technique of pack.techniques) lines.push(`- ${technique}`);
  }
  return lines.join("\n");
}

/** 合并内置与自定义包，按启用列表过滤。 */
export function effectiveSkillPacks(file: SkillPackFile): SkillPack[] {
  const enabled = new Set(file.enabled);
  return [...BUILTIN_SKILL_PACKS, ...file.custom].filter((pack) => enabled.has(pack.id));
}
