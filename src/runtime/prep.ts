import { PREP_STAGES, PrepSessionSchema, type PrepMessage, type PrepSession, type PrepStage } from "../domain/prep.js";
import { ConstitutionSchema, emptyConstitution } from "../domain/constitution.js";
import type { Store } from "../store/index.js";
import { coCreate } from "./cocreate.js";

export interface PrepHostFacade { chat(prompt: string): Promise<string>; }

const STAGE_GOALS: Record<PrepStage, string> = {
  intent: "搞清用户想写什么",
  premise: "题材、主角、核心冲突与爽点",
  worldview: "力量体系、世界规则与代价",
  outline: "卷弧章骨架与钩子策略",
  ready: "检查准备材料并等待用户确认",
};

export class PrepRunner {
  constructor(private readonly host: PrepHostFacade, private readonly store: Store) {}

  async createSession(bookId: string, title = ""): Promise<PrepSession> {
    const now = new Date().toISOString();
    const session = PrepSessionSchema.parse({ id: `prep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, bookId, title: title.trim().slice(0, 60), createdAt: now, updatedAt: now });
    await this.store.prep.save(session);
    return session;
  }

  async chat(sessionId: string, userText: string): Promise<{ session: PrepSession; reply: PrepMessage }> {
    const session = await this.requireActive(sessionId);
    const text = userText.trim();
    if (!text) throw new Error("消息不能为空");
    const userMessage = this.message(session, "user", text);
    let next = { ...session, rounds: session.rounds + 1, messages: [...session.messages, userMessage], updatedAt: userMessage.ts };
    await this.persistMessage(next, userMessage);
    const recent = next.messages.slice(-30);
    const omitted = next.messages.length - recent.length;
    const history = recent.map((message) => ({ role: message.role, content: message.content }));
    if (omitted > 0) history.unshift({ role: "assistant", content: `[更早对话 ${omitted} 条已省略]` });
    const result = await coCreate(history, (conversation) => this.host.chat(`${systemPrompt(next.stage)}\n\n对话历史：\n${conversation}`));
    const reply: PrepMessage = { ...this.message(next, "assistant", result.message), suggestions: result.suggestions };
    next = { ...next, messages: [...next.messages, reply], updatedAt: reply.ts };
    await this.persistMessage(next, reply);
    return { session: next, reply };
  }

  async advance(sessionId: string): Promise<PrepSession> {
    const session = await this.requireActive(sessionId);
    const index = PREP_STAGES.indexOf(session.stage);
    const stage = PREP_STAGES[Math.min(index + 1, PREP_STAGES.length - 1)]!;
    const next = { ...session, stage, updatedAt: new Date().toISOString() };
    await this.store.prep.save(next);
    return next;
  }

  async confirm(sessionId: string): Promise<{ brief: string }> {
    const session = await this.requireActive(sessionId);
    if (session.stage !== "ready") throw new Error("准备阶段尚未到 ready");
    const conversation = session.messages.map((message) => `${message.role}: ${message.content}`).join("\n");
    const raw = await this.host.chat(`请把以下创作准备对话蒸馏成 800 字内总纲，覆盖题材、主角、核心冲突、爽点、世界观要点、分卷意向。只输出 <brief>...</brief>。\n\n${conversation}`);
    const brief = raw.match(/<brief>([\s\S]*?)<\/brief>/i)?.[1]?.trim() || raw.trim();
    if (!brief) throw new Error("未生成有效总纲");
    const now = new Date().toISOString();
    const next = { ...session, status: "confirmed" as const, distilledBrief: brief.slice(0, 800), confirmedAt: now, updatedAt: now };
    await this.store.prep.save(next);
    await this.store.outline.savePremise(next.distilledBrief).catch(() => undefined);
    await this.mergeRules(`${next.messages.map((message) => message.content).join("\n")}\n${next.distilledBrief}`).catch(() => undefined);
    return { brief: next.distilledBrief };
  }

  async abandon(sessionId: string): Promise<PrepSession> {
    const session = await this.requireActive(sessionId);
    const next = { ...session, status: "abandoned" as const, updatedAt: new Date().toISOString() };
    await this.store.prep.save(next);
    return next;
  }

  load(sessionId: string): Promise<PrepSession | null> { return this.store.prep.load(sessionId); }
  async list(): Promise<Array<Omit<PrepSession, "messages"> & { messageCount: number }>> {
    return (await this.store.prep.list()).map(({ messages, ...session }) => ({ ...session, messageCount: messages.length }));
  }

  private async requireActive(id: string): Promise<PrepSession> {
    const session = await this.store.prep.load(id);
    if (!session) throw new Error("准备会话不存在");
    if (session.status !== "active") throw new Error("准备会话已经结束");
    return session;
  }

  private message(session: PrepSession, role: "user" | "assistant", content: string): PrepMessage {
    return { id: `m-${session.messages.length + 1}`, role, content, ts: new Date().toISOString(), stage: session.stage, suggestions: [] };
  }

  private async persistMessage(session: PrepSession, message: PrepMessage): Promise<void> {
    await this.store.sessions.logPrep({ sessionId: session.id, bookId: session.bookId, ...message });
    await this.store.prep.save(session);
  }

  private async mergeRules(text: string): Promise<void> {
    const rules = text.split(/[。！？\n]+/).map((line) => line.trim()).filter((line) => /不得|必须|代价/.test(line)).slice(0, 20);
    if (!rules.length) return;
    const loaded = await this.store.constitution.load().catch(() => null);
    const parsed = loaded ? ConstitutionSchema.safeParse(loaded) : null;
    const current = parsed?.success ? parsed.data : emptyConstitution();
    await this.store.constitution.save({ ...current, worldRules: [...new Set([...current.worldRules, ...rules])], updatedAt: new Date().toISOString() });
  }
}

function systemPrompt(stage: PrepStage): string {
  return `你是 SynChronicle 的创作策划。当前阶段：${stage}。阶段目标：${STAGE_GOALS[stage]}。
规则：
1. 每轮回复必须包含 <reply>（对用户说的话，口语化、每次不超过 300 字）与 <suggestions>（2-4 条下一步可选方向，每条一行）。
2. 你认为准备已充分时输出 <ready>true</ready>，但绝不能替用户决定结束。
3. ${stage} 阶段之外的内容点到为止，提示用户先完成当前阶段。
4. 主动但克制：用户思路卡住时，给具体的、可选择的提醒。`;
}
