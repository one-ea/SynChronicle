import { FileIO } from "../store/io.js";
import type { Store } from "../store/index.js";
import type { Host } from "./host.js";
import { applyChapterText } from "./chapterapply.js";
import { goldenChapterScore } from "../diag/golden.js";
import { AUTOPILOT_PATH, AutopilotStateSchema, emptyAutopilotState, type AutopilotPhase, type AutopilotSettings, type AutopilotState } from "../domain/autopilot.js";

/**
 * 自动驾驶流水线（specs/2026-09-19-p8-autopilot-pipeline）。
 * 前提 → 大纲 → 逐章（写作 → 编辑打分 → 有界重写 → 采纳），
 * 检查点暂停等微调，暂停/预算在章节边界生效，状态每步落盘 meta/autopilot.json。
 */

/** runner 依赖的最小 Host 面（结构兼容，便于测试替身）。 */
export interface AutopilotHostFacade {
  continue(prompt: string): Promise<void>;
  inject(text: string): Promise<unknown>;
  usage: { snapshot(): { overall: { cost_usd: number } } };
}

const REVIEW_PHASES: AutopilotPhase[] = ["premise-review", "outline-review", "chapter-review"];

export class AutopilotRunner {
  private state: AutopilotState = emptyAutopilotState();
  private readonly io: FileIO;
  private pauseRequested = false;
  private driving = false;
  private bestText = "";
  private bestScore = 0;

  constructor(private readonly host: Host | AutopilotHostFacade, private readonly store: Store) {
    this.io = new FileIO(store.dir);
  }

  getState(): AutopilotState { return this.state; }

  isBusy(): boolean { return this.driving; }

  /** 载入持久化状态；运行中相位在进程重启后视为 stopped（等待用户 resume）。 */
  async load(): Promise<AutopilotState> {
    const data = await this.io.readJSON<AutopilotState>(AUTOPILOT_PATH);
    const parsed = data ? AutopilotStateSchema.safeParse(data) : null;
    this.state = parsed?.success ? parsed.data : emptyAutopilotState();
    if (["premise", "outline", "writing", "premise-review", "outline-review", "chapter-review"].includes(this.state.phase)) {
      this.state = { ...this.state, phase: "stopped" };
      await this.persist();
    }
    return this.state;
  }

  async start(idea: string, settings: AutopilotSettings, budgetUsd: number): Promise<AutopilotState> {
    if (this.driving) throw new Error("自动驾驶正在运行中");
    if (this.state.phase !== "idle" && this.state.phase !== "error" && this.state.phase !== "complete") throw new Error(`当前相位 ${this.state.phase} 不可启动，请先恢复或重置`);
    if (!idea.trim()) throw new Error("idea 不能为空");
    const now = new Date().toISOString();
    this.state = { ...emptyAutopilotState(), phase: "premise", stage: "premise", idea: idea.trim(), settings, budgetUsd, startedAt: now };
    this.pauseRequested = false;
    this.bestText = "";
    this.bestScore = 0;
    await this.persist();
    void this.drive();
    return this.state;
  }

  /** 检查点放行。 */
  async proceed(): Promise<AutopilotState> {
    this.assertAlive();
    if (this.state.phase === "premise-review") {
      this.state = { ...this.state, phase: "outline", stage: "outline" };
      await this.persist();
      void this.drive();
    } else if (this.state.phase === "outline-review") {
      this.state = { ...this.state, phase: "writing", stage: "writing" };
      await this.persist();
      void this.drive();
    } else if (this.state.phase === "chapter-review") {
      this.state = { ...this.state, phase: "writing" };
      await this.persist();
      void this.drive();
    } else if (this.state.phase === "stopped") {
      await this.resume();
    } else {
      throw new Error(`当前相位 ${this.state.phase} 无需放行`);
    }
    return this.state;
  }

  /** 检查点微调：前提直接覆写，大纲作为干预注入下一轮。 */
  async tweak(text: string): Promise<AutopilotState> {
    this.assertAlive();
    if (!text.trim()) throw new Error("微调内容不能为空");
    if (this.state.phase === "premise-review") {
      await this.store.outline.savePremise(text);
      this.state = { ...this.state, proposal: text };
      return this.proceed();
    }
    if (this.state.phase === "outline-review") {
      await this.host.inject(`[大纲微调] ${text}`);
      return this.proceed();
    }
    throw new Error("当前相位不支持微调");
  }

  async pause(): Promise<AutopilotState> {
    this.assertAlive();
    if (REVIEW_PHASES.includes(this.state.phase) || this.state.phase === "stopped") {
      this.state = { ...this.state, phase: "stopped", stoppedAt: new Date().toISOString(), error: "用户暂停" };
      await this.persist();
      return this.state;
    }
    this.pauseRequested = true;
    return this.state;
  }

  async resume(): Promise<AutopilotState> {
    this.assertAlive();
    if (this.state.phase !== "stopped") throw new Error(`当前相位 ${this.state.phase} 不可恢复`);
    this.pauseRequested = false;
    const phase: AutopilotPhase = this.state.stage === "premise" ? "premise" : this.state.stage === "outline" ? "outline" : "writing";
    this.state = { ...this.state, phase, error: "", stoppedAt: null };
    await this.persist();
    void this.drive();
    return this.state;
  }

  /** 章节被人工保存后移出复核清单（web 保存路径调用）。 */
  async clearReview(chapter: number): Promise<void> {
    if (!this.state.reviewQueue.includes(chapter)) return;
    this.state = { ...this.state, reviewQueue: this.state.reviewQueue.filter((item) => item !== chapter) };
    await this.persist();
  }

  private assertAlive(): void {
    if (this.state.phase === "idle" || this.state.phase === "complete") throw new Error("自动驾驶未启动");
  }

  private async persist(): Promise<void> {
    await this.io.writeJSON(AUTOPILOT_PATH, this.state);
  }

  private checkpointEnabled(kind: "premise" | "outline" | "chapter"): boolean {
    const mode = this.state.settings.checkpoint;
    if (mode === "none") return false;
    if (mode === "premise-outline") return kind === "premise" || kind === "outline";
    return kind === "chapter";
  }

  private async drive(): Promise<void> {
    if (this.driving) return;
    this.driving = true;
    try {
      while (!this.pauseRequested) {
        if (this.state.stage === "premise") {
          await this.runPremiseStage();
          if (this.state.phase === "premise-review") return;
          this.state = { ...this.state, stage: "outline" };
          await this.persist();
        } else if (this.state.stage === "outline") {
          await this.runOutlineStage();
          if (this.state.phase === "outline-review") return;
          this.state = { ...this.state, stage: "writing" };
          await this.persist();
        } else {
          const finished = await this.runWritingLoop();
          if (finished) return;
        }
      }
      await this.stop("用户暂停");
    } catch (error) {
      this.state = { ...this.state, phase: "error", error: error instanceof Error ? error.message : String(error) };
      await this.persist();
    } finally {
      this.driving = false;
    }
  }

  private async runPremiseStage(): Promise<void> {
    this.state = { ...this.state, phase: "premise" };
    await this.persist();
    await this.host.continue(`[自动驾驶] 根据以下想法生成小说前提设定（题材、主角、核心冲突、爽点、预计篇幅），并写入 premise：\n${this.state.idea}`);
    const premise = await this.store.outline.loadPremise();
    this.state = { ...this.state, proposal: premise || "" };
    await this.persist();
    if (this.checkpointEnabled("premise")) {
      this.state = { ...this.state, phase: "premise-review" };
      await this.persist();
    }
  }

  private async runOutlineStage(): Promise<void> {
    this.state = { ...this.state, phase: "outline" };
    await this.persist();
    await this.host.continue("[自动驾驶] 基于 premise 生成卷/弧/章三层大纲（每章含核心事件与钩子）并持久化大纲。");
    const outline = await this.store.outline.loadOutline();
    const summary = outline.length
      ? outline.slice(0, 40).map((item) => `第${item.chapter}章 ${item.title}${item.hook ? `（钩子：${item.hook}）` : ""}`).join("\n")
      : "";
    this.state = { ...this.state, proposal: summary };
    await this.persist();
    if (this.checkpointEnabled("outline")) {
      this.state = { ...this.state, phase: "outline-review" };
      await this.persist();
    }
  }

  /** 返回 true 表示流水线结束（完成/停止/检查点），false 表示外层应继续。 */
  private async runWritingLoop(): Promise<boolean> {
    this.state = { ...this.state, phase: "writing" };
    await this.persist();
    while (!this.pauseRequested) {
      const budget = await this.checkBudget();
      if (!budget.ok) { await this.stop(`预算耗尽（已消费 $${budget.cost.toFixed(2)} / 上限 $${budget.limit.toFixed(2)}）`); return true; }
      const next = await this.nextChapter();
      if (!next) {
        const completed = { ...this.state, phase: "complete" as const };
        await this.io.writeJSON(AUTOPILOT_PATH, completed);
        this.state = completed;
        return true;
      }
      const chapter = next;
      this.state = { ...this.state, currentChapter: chapter, rewriteCount: 0, lastScore: 0 };
      this.bestText = "";
      this.bestScore = 0;
      await this.persist();
      let adopted = false;
      while (!adopted) {
        const prefix = this.state.rewriteCount > 0
          ? `[自动驾驶重写指令] 上一稿综合 ${this.state.lastScore} 分（阈值 ${this.state.settings.scoreThreshold}），请针对失分维度重写并提升质量。\n`
          : "";
        await this.host.continue(`${prefix}[自动驾驶] 写第 ${chapter} 章正文并提交终稿。`);
        const text = (await this.store.drafts.loadChapterText(chapter)) || (await this.store.drafts.loadDraft(chapter)) || "";
        const score = text.trim() ? this.scoreChapter(chapter, text) : 0;
        if (score > this.bestScore) { this.bestScore = score; this.bestText = text; }
        this.state = { ...this.state, lastScore: score };
        await this.persist();
        if (score >= this.state.settings.scoreThreshold) {
          await this.adoptChapter(chapter, this.bestText || text, score, false);
          adopted = true;
        } else if (this.state.rewriteCount < this.state.settings.maxRewrites) {
          this.state = { ...this.state, rewriteCount: this.state.rewriteCount + 1 };
          await this.persist();
        } else {
          await this.adoptChapter(chapter, this.bestText || text, this.bestScore, true);
          adopted = true;
        }
      }
      if (this.checkpointEnabled("chapter") && (await this.nextChapter())) {
        this.state = { ...this.state, phase: "chapter-review" };
        await this.persist();
        return true;
      }
    }
    return false;
  }

  private async adoptChapter(chapter: number, text: string, score: number, needsReview: boolean): Promise<void> {
    await applyChapterText(this.store, chapter, text, needsReview ? "autopilot-review" : "autopilot");
    const progress = await this.store.progress.load();
    if (progress) {
      await this.store.progress.save({
        ...progress,
        current_chapter: Math.max(progress.current_chapter, chapter + 1),
        in_progress_chapter: 0,
      });
    }
    this.state = {
      ...this.state,
      adoptedCount: this.state.adoptedCount + 1,
      bestScore: score,
      reviewQueue: needsReview ? [...this.state.reviewQueue, chapter] : this.state.reviewQueue,
    };
    await this.persist();
  }

  private scoreChapter(chapter: number, text: string): number {
    return goldenChapterScore(chapter, text)?.score ?? 0;
  }

  private async nextChapter(): Promise<number | null> {
    const progress = await this.store.progress.load();
    if (!progress) return null;
    const total = progress.total_chapters ?? 0;
    const lastDone = [...(progress.completed_chapters ?? [])].reduce((max, item) => Math.max(max, item), 0);
    const next = Math.max(progress.current_chapter, lastDone + 1, 1);
    if (total > 0 && next > total) return null;
    return next;
  }

  private async checkBudget(): Promise<{ ok: boolean; cost: number; limit: number }> {
    const limit = this.state.budgetUsd;
    const cost = this.host.usage.snapshot().overall.cost_usd;
    this.state = { ...this.state, costUsd: Math.round(cost * 10000) / 10000 };
    return { ok: limit <= 0 || cost < limit, cost, limit };
  }

  private async stop(reason: string): Promise<void> {
    this.state = { ...this.state, phase: "stopped", stoppedAt: new Date().toISOString(), error: reason };
    await this.persist();
  }
}
