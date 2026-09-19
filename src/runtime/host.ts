import type { Config } from "../config/index.js";
import { ConfigSchema } from "../config/index.js";
import type { Bundle, ReflectionRuntimePayload, RuntimeEvent, RuntimeQueueItem } from "../domain/index.js";
import { createModelSet } from "../providers/index.js";
import { Store } from "../store/index.js";
import { buildCoordinator } from "../agents/build.js";
import { AsyncQueue } from "./asyncQueue.js";
import { RuntimeStream } from "./stream.js";
import { buildResumePrompt } from "./resume.js";
import { renderConstitutionText } from "./constitution.js";
import { emptyConstitution } from "../domain/constitution.js";
import { effectiveSkillPacks, emptySkillPackFile, renderSkillPacks } from "../domain/skillpack.js";
import { errorEvent, reflectionEvent, systemEvent } from "./observer.js";
import { importTextFile } from "./imp/index.js";
import { exportNovel, type ExportOptions } from "./exp/index.js";
import { simulateSources } from "./sim/index.js";
import { normalizeUsage, UsageTracker, type ModelIdentity, type ModelUsage } from "./usage.js";
import { prepareUserRules } from "./prepareUserRules.js";
import { FileIO } from "../store/io.js";
import type { AskUserHandler } from "../tools/registry.js";
import type { ReflectionEvent } from "../agents/reflection/index.js";

export interface RuntimeObserver { reflection(event: ReflectionEvent & { agent: string }): void | Promise<void>; usage(agent: string, usage: ModelUsage | undefined, model?: ModelIdentity): void; }
export interface RuntimeAgent { run(prompt: string, signal?: AbortSignal): AsyncIterable<string>; setObserver?(observer: RuntimeObserver): void; abort(reason: string): void; close(): void | Promise<void>; }
export interface HostDependencies { agent?: RuntimeAgent; store?: Store; askUser?: AskUserHandler }
type RuntimeState = "idle" | "running" | "paused" | "completed" | "closed";

export class Host {
  readonly store: Store;
  readonly usage: UsageTracker;
  private state: RuntimeState = "idle";
  private recoveryLabel: string | null = null;
  private reflection: { round?: number; maxRounds?: number; score?: number; passed?: boolean } | undefined;
  private eventQueue = new AsyncQueue<RuntimeEvent>();
  private output = new RuntimeStream();
  private queueWrites = new Set<Promise<void>>();
  private queueError: Error | null = null;
  private runController: AbortController | null = null;
  private seenEventIds = new Set<string>();
  private readonly injectIO: FileIO;
  private injectionChain = Promise.resolve();
  private constructor(private readonly config: Config, private readonly agent: RuntimeAgent, store: Store) { this.store = store; this.injectIO = new FileIO(store.dir); this.usage = new UsageTracker((state) => this.store.usage.save(state)); this.agent.setObserver?.({ reflection: (event) => this.observeReflection(event), usage: (agent, usage, model) => this.usage.record(agent, usage?.model ? usage : normalizeUsage(usage, model)) }); }

  static async new(config: Config, bundle: Bundle, dependencies: HostDependencies = {}): Promise<Host> { const cfg = ConfigSchema.parse(config); const store = dependencies.store ?? new Store(cfg.output_dir ?? "output/novel"); await store.init(); let runtimeAgent = dependencies.agent; let host: Host | undefined; if (!runtimeAgent) { const models = createModelSet(cfg); try { await prepareUserRules(store, models); } catch { /* 快照缺失不阻断启动 */ } const built = buildCoordinator(cfg, store, models, bundle, (agent, usage, model) => host?.usage.record(agent, normalizeUsage(usage, model)), undefined, undefined, dependencies.askUser, (event) => host?.observeReflection(event), () => host?.hasBudget() ?? true); runtimeAgent = { run(prompt, signal) { const stream = built.coordinator.stream(prompt, signal); return stream.textStream; }, abort() { built.coordinator.clear(); }, close() { built.coordinator.clear(); } }; } host = new Host(cfg, runtimeAgent, store); host.usage.load(await store.usage.load()); for (const item of await store.runtime.loadQueue()) { const payload = item.payload as RuntimeEvent | undefined; if (item.kind === "ui_event" && payload?.id) host.seenEventIds.add(payload.id); } return host; }

  async startPrepared(prompt: string): Promise<void> { if (!prompt.trim()) throw new Error("prompt is empty"); await this.run(prompt, "启动创作"); }
  /**
   * 注入干预意见（对应 docs/architecture.md §8.3 运行中干预）。
   * AI SDK 无运行中消息注入通道，故持久化到 `meta/injections.jsonl`，
   * 在**下一次 run**（startPrepared/continue/resume）开头以 `[用户干预]` 前缀送达。
   */
  async inject(text: string): Promise<void> {
    const value = text.trim();
    if (!value) return;
    await this.withInjectionLock(async () => {
      await this.injectIO.appendJSONLine("meta/injections.jsonl", { text: value, time: new Date().toISOString() });
    });
    this.emit(systemEvent(`注入干预：${value.slice(0, 40)}`));
  }
  /**
   * 运行中 Steer 重定向（打断当前生成、回滚至指定或当前未完成章节、注入偏航指引并重启续写）。
   */
  async steer(options: { prompt: string; targetChapter?: number }): Promise<{ aborted: boolean; targetChapter: number }> {
    const text = options.prompt.trim();
    if (!text) throw new Error("steer prompt is empty");

    let wasRunning = false;
    if (this.state === "running") {
      wasRunning = true;
      this.abort("用户发起 Steer 偏航纠正");
      // 等待上一次 run 循环因 abort 释放
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const progress = await this.store.progress.load();
    if (!progress) throw new Error("尚未初始化创作进度，无法执行 Steer 回滚");
    // 目标章节：优先指定，否则当前未完成章节，否则最近推进章节
    const chapter = options.targetChapter ?? ((progress.in_progress_chapter ?? 0) > 0 ? progress.in_progress_chapter! : progress.current_chapter);
    if (!chapter || chapter <= 0) throw new Error("无可回退的目标章节");

    // 回滚：清理该章节正在进行中但未提交的草稿与暂存
    await this.store.signals.clearPendingCommit();
    await this.store.progress.save({
      ...progress,
      in_progress_chapter: chapter,
      current_chapter: chapter,
      flow: "writing",
    });

    // 注入引导词（下一次 run/resume 读取）
    await this.inject(`[Steer 引导指令: 第 ${chapter} 章] ${text}`);

    return { aborted: wasRunning, targetChapter: chapter };
  }

  async resume(): Promise<{ label: string | null; error?: Error }> { const data = buildResumePrompt(await this.store.progress.load(), await this.store.runMeta.load()); this.recoveryLabel = data.label; if (!data.label) return { label: null }; try { await this.run(data.prompt, data.label); await this.store.clearHandledSteer(); return { label: data.label }; } catch (error) { return { label: data.label, error: error instanceof Error ? error : new Error(String(error)) }; } }
  async continue(prompt: string): Promise<void> { if (!prompt.trim()) throw new Error("continue prompt is empty"); await this.run(prompt, "继续创作"); }
  async chat(prompt: string): Promise<string> { let output = ""; for await (const delta of this.agent.run(prompt)) output += delta; return output; }
  abort(reason: string, level = "info"): void { if (this.state === "closed") return; this.runController?.abort(new Error(reason)); this.agent.abort(reason); this.state = "paused"; this.emit({ ...systemEvent(reason, level), payload: { level } }); }
  async close(): Promise<void> { if (this.state === "closed") return; let failure: Error | null = null; try { await this.agent.close(); } catch (error) { failure = toError(error); } try { await this.usage.flush(); } catch (error) { failure ??= toError(error); } await Promise.all([...this.queueWrites]); failure ??= this.queueError; this.state = "closed"; this.eventQueue.close(); this.output.close(); if (failure) throw failure; }
  events(): AsyncIterable<RuntimeEvent> { return this.eventQueue; }
  stream(includeBoundaries = false): AsyncIterable<string> { return this.output.iterable(includeBoundaries); }
  snapshot() { const progress = { runtimeState: this.state, recoveryLabel: this.recoveryLabel, usage: this.usage.snapshot(), provider: this.config.provider, model: this.config.model, reflection: this.reflection }; return structuredClone(progress); }
  async replayQueue(maxItems = 100): Promise<RuntimeQueueItem[]> { const items = await this.store.runtime.loadQueue(); return items.slice(-Math.max(0, maxItems)); }
  async importText(path: string): Promise<{ chapters: number }> { const chapters = await importTextFile(path); if (!chapters.length) throw new Error("文本中没有可导入的章节"); const numbers = chapters.map((chapter) => chapter.chapter); if (new Set(numbers).size !== numbers.length || numbers.some((chapter) => chapter <= 0)) throw new Error("导入章节编号必须是唯一的正整数"); for (const chapter of chapters) { const content = `# ${chapter.title}\n\n${chapter.content}`; await this.store.drafts.saveFinalChapter(chapter.chapter, content); await this.store.versions.record(chapter.chapter, content, "import").catch(() => undefined); } for (const chapter of chapters) { await this.store.summaries.saveSummary({ chapter: chapter.chapter, summary: "导入章节", characters: [], key_events: [] }); await this.store.checkpoints.appendArtifact({ kind: "chapter", chapter: chapter.chapter }, "commit", `chapters/${String(chapter.chapter).padStart(2, "0")}.md`); } const words = chapters.reduce((sum, chapter) => sum + [...chapter.content.replace(/\s/g, "")].length, 0); await this.store.progress.save({ novel_name: "", phase: "writing", current_chapter: Math.max(...numbers) + 1, total_chapters: Math.max(...numbers), completed_chapters: numbers, total_word_count: words, chapter_word_counts: Object.fromEntries(chapters.map((chapter) => [String(chapter.chapter), [...chapter.content.replace(/\s/g, "")].length])), flow: "writing", in_progress_chapter: 0, pending_rewrites: [] }); await this.store.signals.clearPendingCommit(); return { chapters: chapters.length }; }
  export(options: ExportOptions) { return exportNovel(this.store, options); }
  simulate(options: { sources: string[] }) { return simulateSources(options.sources); }

  private hasBudget(): boolean { const limit = this.config.budget?.book_usd ?? 0; return limit <= 0 || this.usage.snapshot().overall.cost_usd < limit; }

  private async run(prompt: string, label: string): Promise<void> {
    if (this.state === "running" || this.state === "closed") throw new Error(`host is ${this.state}`);
    this.state = "running";
    const controller = new AbortController();
    this.runController = controller;
    this.emit(systemEvent(label));
    const injections = await this.consumeInjections();
    const loadedConstitution = await this.store.constitution.load().catch(() => null);
    const constitutionText = renderConstitutionText(loadedConstitution ?? emptyConstitution());
    const loadedSkillPacks = await this.store.skillpacks.load().catch(() => null);
    const skillPackText = renderSkillPacks(effectiveSkillPacks(loadedSkillPacks ?? emptySkillPackFile()));
    const finalPrompt = `${constitutionText ? constitutionText + "\n\n" : ""}${skillPackText ? skillPackText + "\n\n" : ""}${injections.length ? `${injections.map(text => `[用户干预] ${text}`).join("\n\n")}\n\n` : ""}${prompt}`;
    try {
      const stream = this.agent.run(finalPrompt, controller.signal);
      for await (const delta of stream) {
        controller.signal.throwIfAborted();
        this.output.write(delta);
        await this.store.runtime.appendQueue({ seq: 0, time: new Date().toISOString(), kind: "stream_delta", priority: "background", payload: { delta } });
      }
      controller.signal.throwIfAborted();
      this.state = "completed";
      this.emit(systemEvent("运行完成", "success"));
    } catch (error) {
      this.state = "paused";
      this.emit(errorEvent(error));
      // 主动中止（abort/steer）时向上抛出取消原因；生成级异常优雅吸收，避免未捕获 Promise/WebStream 导致主进程异常退出
      if (controller.signal.aborted) throw controller.signal.reason ?? toError(error);
    } finally {
      if (this.runController === controller) this.runController = null;
      this.output.end();
    }
  }
  private async consumeInjections(): Promise<string[]> {
    return this.withInjectionLock(async () => {
      const raw = await this.injectIO.readText("meta/injections.jsonl");
      const lines = raw.split(/\r?\n/).filter(Boolean);
      const texts: string[] = [];
      const invalid: string[] = [];
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as { text?: unknown };
          if (typeof parsed.text === "string" && parsed.text.trim()) texts.push(parsed.text.trim());
          else invalid.push(line);
        } catch {
          invalid.push(line);
        }
      }
      if (invalid.length) await this.injectIO.writeFile("meta/injections.jsonl", `${invalid.join("\n")}\n`);
      else await this.injectIO.writeFile("meta/injections.jsonl", "");
      return texts;
    });
  }
  private withInjectionLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.injectionChain.then(operation);
    this.injectionChain = result.then(() => undefined, () => undefined);
    return result;
  }
  private async observeReflection(event: ReflectionEvent & { agent: string }): Promise<void> { const projected = reflectionEvent(event); if (projected.id && this.seenEventIds.has(projected.id)) return; await this.persistEvent(projected); if (projected.id) this.seenEventIds.add(projected.id); this.updateReflection(projected.payload); this.eventQueue.push(projected); }
  private updateReflection(payload: ReflectionRuntimePayload): void { if (payload.phase === "started") this.reflection = { round: 1, maxRounds: payload.maxRounds }; else if (payload.phase === "revision_started") this.reflection = { ...this.reflection, round: payload.round }; else if (payload.phase === "review_completed") this.reflection = { ...this.reflection, round: payload.round, score: payload.score, passed: payload.passed }; else this.reflection = { ...this.reflection, round: payload.rounds, score: payload.score, passed: payload.passed }; }
  private emit(event: RuntimeEvent): void { this.eventQueue.push(event); this.trackQueueWrite(this.store.runtime.appendQueue({ seq: 0, time: event.time ?? new Date().toISOString(), kind: "ui_event", priority: event.type === "error" ? "control" : "background", category: event.type.toUpperCase(), summary: event.message, payload: event })); }
  private persistEvent(event: RuntimeEvent): Promise<void> { return this.store.runtime.appendQueue({ seq: event.sequence ?? 0, time: event.time ?? new Date().toISOString(), kind: "ui_event", priority: event.type === "error" ? "control" : "background", category: event.type.toUpperCase(), summary: event.message, payload: event }).then(() => undefined); }
  private trackQueueWrite(operation: Promise<unknown>): void { let tracked: Promise<void>; tracked = operation.then(() => undefined, (error) => { this.queueError ??= toError(error); }).finally(() => this.queueWrites.delete(tracked)); this.queueWrites.add(tracked); }
}

function toError(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)); }
