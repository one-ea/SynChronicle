import type { Entity } from "./entity.js";

/**
 * 角色对话推演（specs/2026-09-19-p5-creation-workbench R3）。
 * 实体卡数据驱动的确定性应答模拟 + 可复制角色提示词。零模型依赖。
 */

export interface ChatTurn { role: "user" | "character"; text: string }
export interface ChatResult { reply: string; prompt: string }

export function buildCharacterPrompt(entity: Entity): string {
  const lines: string[] = [];
  lines.push(`# 角色扮演：${entity.name}${entity.aliases.length ? `（别名：${entity.aliases.join("、")}）` : ""}`);
  if (entity.description.trim()) lines.push(`\n## 人设\n${entity.description}`);
  const latest = entity.states.at(-1);
  if (latest) lines.push(`\n## 当前状态（第 ${latest.chapter} 章）\n- 情绪：${latest.mood}${latest.goals.length ? `\n- 目标：${latest.goals.join("；")}` : ""}${latest.statusNote ? `\n- 备注：${latest.statusNote}` : ""}`);
  if (entity.relations.length) lines.push(`\n## 关系\n${entity.relations.map((relation) => `- ${relation.type} → ${relation.targetId}（好感度 ${relation.strength}）`).join("\n")}`);
  lines.push(`\n## 扮演要求\n- 始终以 ${entity.name} 的第一人称说话，保持人设与当前状态一致\n- 回答贴合小说世界观，用词符合角色身份\n`);
  return lines.join("\n");
}

function replyTemplate(entity: Entity, message: string, turn: number): string {
  const latest = entity.states.at(-1);
  const mood = latest?.mood ?? "平淡";
  const goal = latest?.goals[0];
  const openers = [`“${message.slice(0, 12)}……”`, `“哦？”`, `“你倒是会挑时候。”`, `“这话，我得想想。”`];
  const middles = [
    `${entity.name}抬眼，神色${mood}。`,
    `${entity.name}指尖在桌沿轻叩，语气${mood}。`,
    `一阵沉默后，${entity.name}放下手中的活。`,
  ];
  const endings = goal
    ? [`“眼下我最要紧的，是${goal}。”`, `“等我处理完${goal}，再与你细说。”`]
    : [`“书局的事，从不假手于人。”`, `“你若信我，便按我说的做。”`];
  const random = (turn + message.length) % openers.length;
  return `${openers[random]}${middles[(turn + 1) % middles.length]}${endings[(turn + 2) % endings.length]}`;
}

export function characterReply(entity: Entity, message: string, history: ChatTurn[] = []): ChatResult {
  const text = message.trim();
  if (!text) throw new Error("消息不能为空");
  const reply = replyTemplate(entity, text, history.length);
  return { reply, prompt: buildCharacterPrompt(entity) };
}
