import { createHash } from "node:crypto";
import type { Config } from "../config/index.js";
import { ConfigSchema } from "../config/index.js";
import type { Bundle, ReflectionRuntimePayload, RunMeta, RuntimeEvent, RuntimeQueueItem } from "../domain/index.js";
import { createModelSet, type ModelFactory, type ModelSet } from "../providers/index.js";
import { Store, type StorePort } from "../store/index.js";
import { buildCoordinator } from "../agents/build.js";
import { AsyncQueue } from "./asyncQueue.js";
import { RuntimeStream, type RuntimeStreamChunk } from "./stream.js";
import { buildResumePrompt } from "./resume.js";
import { errorEvent, reflectionEvent, systemEvent } from "./observer.js";
import { importTextFile } from "./imp/index.js";
import { exportNovel, type ExportOptions } from "./exp/index.js";
import { simulateSources } from "./sim/index.js";
import { normalizeUsage, UsageTracker, type ModelIdentity, type ModelUsage } from "./usage.js";
import type { AskUserHandler, AskUserResponse } from "../tools/registry.js";
import type { ReflectionEvent } from "../agents/reflection/index.js";

export interface RuntimeObserver { reflection(event: ReflectionEvent & { agent: string }): void | Promise<void>; usage(agent: string, usage: ModelUsage | undefined, model?: ModelIdentity): void; }
export interface RuntimeAgent { run(prompt: string, signal?: AbortSignal): AsyncIterable<string>; setObserver?(observer: RuntimeObserver): void; abort(reason: string): void; close(): void | Promise<void>; }
export interface HostDependencies { agent?: RuntimeAgent; store?: StorePort; askUser?: AskUserHandler; modelFactory?: ModelFactory; persistStreamDelta?: (sequence: number, text: string) => Promise<RuntimeStreamChunk>; nextModelInvocation?: (input: { agent: string; kind: "generate" | "stream"; logicalKey: string }) => Promise<string>; coordinatorTools?: Array<"draft_chapter" | "commit_chapter"> }
export type HostBoundary = "agent" | "commit:enter" | "commit:exit";
type RuntimeState = "idle" | "running" | "paused" | "completed" | "closed";

export class Host {
  readonly store: StorePort;
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
  private boundaryHandler: ((boundary: HostBoundary) => Promise<void>) | null = null;
  private readonly askWaiters = new Map<string, (response: AskUserResponse) => void>();
  private askAllocation: Promise<void> = Promise.resolve();
  private readonly roleModels = new Map<string, { provider: string; model: string; credentialId?: string; parameters?: Record<string, unknown> }>();
  private constructor(private readonly config: Config, private readonly agent: RuntimeAgent, store: StorePort, private readonly models: ModelSet, private readonly persistStreamDelta?: HostDependencies["persistStreamDelta"]) { this.store = store; const commitStaged = store.commitStaged.bind(store); store.commitStaged = async (staging, candidateIds) => { await this.boundary("commit:enter"); try { await commitStaged(staging, candidateIds); } finally { await this.boundary("commit:exit"); } }; this.usage = new UsageTracker((state) => this.store.usage.save(state)); this.agent.setObserver?.({ reflection: (event) => this.observeReflection(event), usage: (agent, usage, model) => this.recordUsage(agent, usage?.model ? usage : normalizeUsage(usage, model)) }); }

  static async new(config: Config, bundle: Bundle, dependencies: HostDependencies = {}): Promise<Host> { const cfg = ConfigSchema.parse(config); const store = dependencies.store ?? new Store(cfg.output_dir ?? "output/novel"); await store.init(); const models = dependencies.agent ? createModelSet(cfg, () => ({} as ReturnType<ModelSet["forRole"]>)) : createModelSet(cfg, dependencies.modelFactory); let runtimeAgent = dependencies.agent; let host: Host | undefined; if (!runtimeAgent) { const askUser = dependencies.askUser ?? ((questions) => host!.askUser(questions)); const built = buildCoordinator(cfg, store, models, bundle, (agent, usage, model) => host?.recordUsage(agent, normalizeUsage(usage, model)), undefined, undefined, askUser, (event) => host?.observeReflection(event), () => host?.hasBudget() ?? true, dependencies.nextModelInvocation, dependencies.coordinatorTools); runtimeAgent = { run(prompt, signal) { const stream = built.coordinator.stream(prompt, signal); return stream.textStream; }, abort() { built.coordinator.clear(); }, close() { built.coordinator.clear(); } }; } host = new Host(cfg, runtimeAgent, store, models, dependencies.persistStreamDelta); host.usage.load(await store.usage.load()); const runMeta = await store.runMeta.load() as (RunMeta & { role_models?: Record<string, { provider: string; model: string; credentialId?: string; parameters?: Record<string, unknown> }> }) | null; for (const [role, selection] of Object.entries(runMeta?.role_models ?? {})) { await models.swap(role, selection.provider, selection.model, { credentialId: selection.credentialId, temperature: typeof selection.parameters?.temperature === "number" ? selection.parameters.temperature : undefined, maxTokens: typeof selection.parameters?.maxTokens === "number" ? selection.parameters.maxTokens : undefined }); host.roleModels.set(role, selection); } for (const item of await store.runtime.loadQueue()) { const payload = item.payload as RuntimeEvent | undefined; if (item.kind === "ui_event" && payload?.id) host.seenEventIds.add(payload.id); } return host; }

  async startPrepared(prompt: string, signal?: AbortSignal): Promise<void> { if (!prompt.trim()) throw new Error("prompt is empty"); await this.run(prompt, "启动创作", signal); }
  async resume(signal?: AbortSignal): Promise<{ label: string | null; error?: Error }> { const data = buildResumePrompt(await this.store.progress.load(), await this.store.runMeta.load()); this.recoveryLabel = data.label; if (!data.label) return { label: null }; try { await this.run(data.prompt, data.label, signal); return { label: data.label }; } catch (error) { return { label: data.label, error: error instanceof Error ? error : new Error(String(error)) }; } }
  async continue(prompt: string): Promise<void> { if (!prompt.trim()) throw new Error("continue prompt is empty"); await this.run(prompt, "继续创作"); }
  async steer(commandId: string, instruction: string): Promise<void> { const value = instruction.trim(); if (!commandId.trim() || !value) throw new Error("steer command is invalid"); const fallback: RunMeta = { started_at: new Date().toISOString(), provider: this.config.provider, style: this.config.style ?? "", model: this.config.model, planning_tier: "mid", steer_history: [], pending_steer: "", pause_point: null }; await this.store.applySteerCommand(commandId, value, fallback); }
  async askUser(questions: Parameters<AskUserHandler>[0]): Promise<AskUserResponse> {
    let questionId = "";
    const previous = this.askAllocation;
    this.askAllocation = (async () => {
      await previous;
      const items = await this.store.runtime.loadQueue();
      const answered = new Set<string>();
      const pending: Array<{ questionId: string; interactionSequence: number; questions: unknown }> = [];
      for (const item of items) {
        const outer = item.payload as { type?: string; questionId?: string; payload?: { questionId?: string; interactionSequence?: number; questions?: unknown } } | undefined;
        if (outer?.type === "ask_user_answer" && outer.questionId) answered.add(outer.questionId);
        if (outer?.type === "tool" && outer.payload?.questionId) pending.push({ questionId: outer.payload.questionId, interactionSequence: outer.payload.interactionSequence ?? Number.parseInt(outer.payload.questionId, 10), questions: outer.payload.questions });
      }
      const recovered = pending.sort((left, right) => left.interactionSequence - right.interactionSequence).find((candidate) => !answered.has(candidate.questionId) && !this.askWaiters.has(candidate.questionId) && JSON.stringify(candidate.questions) === JSON.stringify(questions));
      if (recovered) {
        questionId = recovered.questionId;
        const event = { type: "tool" as const, tool: "ask_user", id: `ask:${questionId}`, message: "等待用户回答", payload: { questionId, questions } } as RuntimeEvent;
        this.eventQueue.push(event);
        return;
      }
      const current = await this.store.runMeta.load() as (RunMeta & { interaction_sequence?: number }) | null;
      const sequence = (current?.interaction_sequence ?? 0) + 1;
      questionId = `${sequence}:${createHash("sha256").update(JSON.stringify(questions)).digest("hex").slice(0, 20)}`;
      const fallback: RunMeta = { started_at: new Date().toISOString(), provider: this.config.provider, style: this.config.style ?? "", model: this.config.model, planning_tier: "mid", steer_history: [], pending_steer: "", pause_point: null };
      await this.store.runMeta.save({ ...fallback, ...current, interaction_sequence: sequence } as RunMeta);
      const event = { type: "tool" as const, tool: "ask_user", id: `ask:${questionId}`, message: "等待用户回答", payload: { questionId, interactionSequence: sequence, questions } } as RuntimeEvent;
      this.emit(event);
    })();
    await this.askAllocation;
    return new Promise((resolve) => this.askWaiters.set(questionId, resolve));
  }
  async answerUser(questionId: string, answers: Record<string, string>): Promise<void> { const response = { answers, notes: {} }; await this.store.runtime.appendQueue({ seq: 0, time: new Date().toISOString(), kind: "ui_event", priority: "control", category: "ASK_USER.ANSWER", summary: "用户已回答", payload: { type: "ask_user_answer", questionId, ...response } }); this.askWaiters.get(questionId)?.(response); this.askWaiters.delete(questionId); }
  async switchModel(role: string, provider: string, model: string, options: { credentialId?: string; parameters?: Record<string, unknown> } = {}): Promise<void> { const parameters = options.parameters ?? {}; await this.models.swap(role, provider, model, { credentialId: options.credentialId, temperature: typeof parameters.temperature === "number" ? parameters.temperature : undefined, maxTokens: typeof parameters.maxTokens === "number" ? parameters.maxTokens : undefined }); this.roleModels.set(role, { provider, model, ...options }); const current = await this.store.runMeta.load() as (RunMeta & { role_models?: Record<string, { provider: string; model: string }> }) | null; const fallback: RunMeta = { started_at: new Date().toISOString(), provider: this.config.provider, style: this.config.style ?? "", model: this.config.model, planning_tier: "mid", steer_history: [], pending_steer: "", pause_point: null }; await this.store.runMeta.save({ ...fallback, ...current, role_models: Object.fromEntries(this.roleModels) } as RunMeta); }
  abort(reason: string, level = "info"): void { if (this.state === "closed") return; this.runController?.abort(new Error(reason)); this.agent.abort(reason); this.state = "paused"; this.emit({ ...systemEvent(reason, level), payload: { level } }); }
  async close(): Promise<void> { if (this.state === "closed") return; let failure: Error | null = null; try { await this.agent.close(); } catch (error) { failure = toError(error); } try { await this.usage.flush(); } catch (error) { failure ??= toError(error); } await Promise.all([...this.queueWrites]); failure ??= this.queueError; this.state = "closed"; this.eventQueue.close(); this.output.end(); if (failure) throw failure; }
  events(): AsyncIterable<RuntimeEvent> { return this.eventQueue; }
  stream(): AsyncIterable<RuntimeStreamChunk> { return this.output.iterable(); }
  setBoundaryHandler(handler: (boundary: HostBoundary) => Promise<void>): void { this.boundaryHandler = handler; }
  async latestCheckpoint(): Promise<{ taskFingerprint: string; projectVersion: number } | null> { const databaseStore = this.store as StorePort & { latestCheckpoint?: () => Promise<{ taskFingerprint: string; projectVersion: number } | null> }; if (databaseStore.latestCheckpoint) return databaseStore.latestCheckpoint(); const checkpoint = await this.store.checkpoints.latestGlobal(); return checkpoint ? { taskFingerprint: checkpoint.digest ?? "", projectVersion: 1 } : null; }
  snapshot() { const progress = { runtimeState: this.state, recoveryLabel: this.recoveryLabel, usage: this.usage.snapshot(), provider: this.config.provider, model: this.config.model, roleModels: Object.fromEntries(this.roleModels), reflection: this.reflection }; return structuredClone(progress); }
  async replayQueue(maxItems = 100): Promise<RuntimeQueueItem[]> { const items = await this.store.runtime.loadQueue(); return items.slice(-Math.max(0, maxItems)); }
  async importText(path: string): Promise<{ chapters: number }> { const chapters = await importTextFile(path); if (!chapters.length) throw new Error("文本中没有可导入的章节"); for (const chapter of chapters) await this.store.drafts.saveFinalChapter(chapter.chapter, `# ${chapter.title}\n\n${chapter.content}`); const words = chapters.reduce((sum, chapter) => sum + [...chapter.content.replace(/\s/g, "")].length, 0); await this.store.progress.save({ novel_name: "", phase: "writing", current_chapter: chapters.length + 1, total_chapters: chapters.length, completed_chapters: chapters.map((chapter) => chapter.chapter), total_word_count: words, flow: "writing", in_progress_chapter: 0, pending_rewrites: [] }); return { chapters: chapters.length }; }
  export(options: ExportOptions) { return exportNovel(this.store, options); }
  simulate(options: { sources: string[] }) { return simulateSources(options.sources); }

  private hasBudget(): boolean { const limit = this.config.budget?.book_usd ?? 0; return limit <= 0 || this.usage.snapshot().overall.cost_usd < limit; }
  private recordUsage(agent: string, usage: ModelUsage | undefined): void { this.usage.record(agent, usage); const snapshot = this.usage.snapshot(); const publicPayload = { publicType: "usage.snapshot", inputTokens: snapshot.overall.input, outputTokens: snapshot.overall.output, totalTokens: snapshot.overall.input + snapshot.overall.output, cost: snapshot.overall.cost_usd.toFixed(8), byAgent: Object.entries(snapshot.per_agent).map(([name, value]) => ({ agent: name, inputTokens: value.input, outputTokens: value.output, totalTokens: value.input + value.output, cost: value.cost_usd.toFixed(8) })) }; const digest = createHash("sha256").update(JSON.stringify(publicPayload)).digest("hex").slice(0, 24); this.emit({ type: "system", id: `usage:${digest}`, message: "usage updated", payload: publicPayload }); }

  private async run(prompt: string, label: string, externalSignal?: AbortSignal): Promise<void> { if (this.state === "running" || this.state === "closed") throw new Error(`host is ${this.state}`); this.state = "running"; this.runController = new AbortController(); const relayAbort = () => this.runController?.abort(externalSignal?.reason); if (externalSignal?.aborted) relayAbort(); else externalSignal?.addEventListener("abort", relayAbort, { once: true }); this.emit({ ...systemEvent(label), id: `lifecycle:${this.store.dir}:start` }); try { await this.boundary("agent"); const commands = await this.store.pendingSteerCommands(); const steerText = commands.map(({ instruction }) => instruction).join("\n"); const effectivePrompt = steerText && !prompt.includes(steerText) ? `${prompt}\n\n用户干预意见：\n${steerText}` : prompt; let chunkSequence = 0; for await (const delta of this.agent.run(effectivePrompt, this.runController.signal)) { this.runController.signal.throwIfAborted(); chunkSequence += 1; if (this.persistStreamDelta) { const persisted = await this.persistStreamDelta(chunkSequence, delta); this.output.write(persisted.sequence, persisted.text, persisted.eventSequence); } else { const persisted = await this.store.runtime.appendQueue({ seq: 0, time: new Date().toISOString(), kind: "stream_delta", priority: "background", payload: { delta } }); this.output.write(persisted.seq, delta); } } this.runController.signal.throwIfAborted(); if (commands.length || (await this.store.runMeta.load())?.pending_steer) await this.store.completeSteerDelivery(commands.map(({ id }) => id)); await this.boundary("agent"); this.state = "completed"; this.emit({ ...systemEvent("运行完成", "success"), id: `lifecycle:${this.store.dir}:completed` }); } catch (error) { this.state = "paused"; const event = errorEvent(error); this.emit({ ...event, id: `lifecycle:${this.store.dir}:error:${event.message}` }); throw error; } finally { externalSignal?.removeEventListener("abort", relayAbort); this.runController = null; this.output.end(); } }
  private async observeReflection(event: ReflectionEvent & { agent: string }): Promise<void> { const projected = reflectionEvent(event); if (projected.id && this.seenEventIds.has(projected.id)) return; await this.persistEvent(projected); if (projected.id) this.seenEventIds.add(projected.id); this.updateReflection(projected.payload); this.eventQueue.push(projected); }
  private updateReflection(payload: ReflectionRuntimePayload): void { if (payload.phase === "started") this.reflection = { round: 1, maxRounds: payload.maxRounds }; else if (payload.phase === "revision_started") this.reflection = { ...this.reflection, round: payload.round }; else if (payload.phase === "review_completed") this.reflection = { ...this.reflection, round: payload.round, score: payload.score, passed: payload.passed }; else this.reflection = { ...this.reflection, round: payload.rounds, score: payload.score, passed: payload.passed }; }
  private emit(event: RuntimeEvent): void { if (event.id && this.seenEventIds.has(event.id)) return; if (event.id) this.seenEventIds.add(event.id); this.eventQueue.push(event); this.trackQueueWrite(this.store.runtime.appendQueue({ seq: 0, time: event.time ?? new Date().toISOString(), kind: "ui_event", priority: event.type === "error" ? "control" : "background", category: event.type.toUpperCase(), summary: event.message, payload: event })); }
  private persistEvent(event: RuntimeEvent): Promise<void> { return this.store.runtime.appendQueue({ seq: event.sequence ?? 0, time: event.time ?? new Date().toISOString(), kind: "ui_event", priority: event.type === "error" ? "control" : "background", category: event.type.toUpperCase(), summary: event.message, payload: event }).then(() => undefined); }
  private trackQueueWrite(operation: Promise<unknown>): void { let tracked: Promise<void>; tracked = operation.then(() => undefined, (error) => { this.queueError ??= toError(error); }).finally(() => this.queueWrites.delete(tracked)); this.queueWrites.add(tracked); }
  private async boundary(boundary: HostBoundary): Promise<void> { await this.boundaryHandler?.(boundary); }
}

function toError(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)); }
