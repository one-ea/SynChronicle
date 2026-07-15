import type { Config } from "../config/index.js";
import { ConfigSchema } from "../config/index.js";
import type { Bundle, ReflectionRuntimePayload, RunMeta, RuntimeEvent, RuntimeQueueItem } from "../domain/index.js";
import { createModelSet } from "../providers/index.js";
import { Store, type StorePort } from "../store/index.js";
import { buildCoordinator } from "../agents/build.js";
import { AsyncQueue } from "./asyncQueue.js";
import { RuntimeStream } from "./stream.js";
import { buildResumePrompt } from "./resume.js";
import { errorEvent, reflectionEvent, systemEvent } from "./observer.js";
import { importTextFile } from "./imp/index.js";
import { exportNovel, type ExportOptions } from "./exp/index.js";
import { simulateSources } from "./sim/index.js";
import { normalizeUsage, UsageTracker, type ModelIdentity, type ModelUsage } from "./usage.js";
import type { AskUserHandler } from "../tools/registry.js";
import type { ReflectionEvent } from "../agents/reflection/index.js";

export interface RuntimeObserver { reflection(event: ReflectionEvent & { agent: string }): void | Promise<void>; usage(agent: string, usage: ModelUsage | undefined, model?: ModelIdentity): void; }
export interface RuntimeAgent { run(prompt: string, signal?: AbortSignal): AsyncIterable<string>; setObserver?(observer: RuntimeObserver): void; abort(reason: string): void; close(): void | Promise<void>; }
export interface HostDependencies { agent?: RuntimeAgent; store?: StorePort; askUser?: AskUserHandler }
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
  private pendingSteer: string[] = [];
  private constructor(private readonly config: Config, private readonly agent: RuntimeAgent, store: StorePort) { this.store = store; const commitStaged = store.commitStaged.bind(store); store.commitStaged = async (staging, candidateIds) => { await this.boundary("commit:enter"); try { await commitStaged(staging, candidateIds); } finally { await this.boundary("commit:exit"); } }; this.usage = new UsageTracker((state) => this.store.usage.save(state)); this.agent.setObserver?.({ reflection: (event) => this.observeReflection(event), usage: (agent, usage, model) => this.usage.record(agent, usage?.model ? usage : normalizeUsage(usage, model)) }); }

  static async new(config: Config, bundle: Bundle, dependencies: HostDependencies = {}): Promise<Host> { const cfg = ConfigSchema.parse(config); const store = dependencies.store ?? new Store(cfg.output_dir ?? "output/novel"); await store.init(); let runtimeAgent = dependencies.agent; let host: Host | undefined; if (!runtimeAgent) { const built = buildCoordinator(cfg, store, createModelSet(cfg), bundle, (agent, usage, model) => host?.usage.record(agent, normalizeUsage(usage, model)), undefined, undefined, dependencies.askUser, (event) => host?.observeReflection(event), () => host?.hasBudget() ?? true); runtimeAgent = { run(prompt, signal) { const stream = built.coordinator.stream(prompt, signal); return stream.textStream; }, abort() { built.coordinator.clear(); }, close() { built.coordinator.clear(); } }; } host = new Host(cfg, runtimeAgent, store); host.usage.load(await store.usage.load()); for (const item of await store.runtime.loadQueue()) { const payload = item.payload as RuntimeEvent | undefined; if (item.kind === "ui_event" && payload?.id) host.seenEventIds.add(payload.id); } return host; }

  async startPrepared(prompt: string, signal?: AbortSignal): Promise<void> { if (!prompt.trim()) throw new Error("prompt is empty"); await this.run(prompt, "启动创作", signal); }
  async resume(signal?: AbortSignal): Promise<{ label: string | null; error?: Error }> { const data = buildResumePrompt(await this.store.progress.load(), await this.store.runMeta.load()); this.recoveryLabel = data.label; if (!data.label) return { label: null }; try { await this.run(data.prompt, data.label, signal); return { label: data.label }; } catch (error) { return { label: data.label, error: error instanceof Error ? error : new Error(String(error)) }; } }
  async continue(prompt: string): Promise<void> { if (!prompt.trim()) throw new Error("continue prompt is empty"); await this.run(prompt, "继续创作"); }
  async steer(commandId: string, instruction: string): Promise<void> { const value = instruction.trim(); if (!commandId.trim() || !value) throw new Error("steer command is invalid"); const fallback: RunMeta = { started_at: new Date().toISOString(), provider: this.config.provider, style: this.config.style ?? "", model: this.config.model, planning_tier: "mid", steer_history: [], pending_steer: "", pause_point: null }; const databaseStore = this.store as StorePort & { applySteerCommand?: (id: string, value: string, fallback: RunMeta) => Promise<boolean> }; const applied = databaseStore.applySteerCommand ? await databaseStore.applySteerCommand(commandId, value, fallback) : true; if (applied) { this.pendingSteer.push(value); const meta = await this.store.runMeta.load(); if (!databaseStore.applySteerCommand && meta) await this.store.runMeta.save({ ...meta, pending_steer: [meta.pending_steer, value].filter(Boolean).join("\n"), steer_history: [...meta.steer_history, { input: value, timestamp: new Date().toISOString() }] }); } }
  abort(reason: string, level = "info"): void { if (this.state === "closed") return; this.runController?.abort(new Error(reason)); this.agent.abort(reason); this.state = "paused"; this.emit({ ...systemEvent(reason, level), payload: { level } }); }
  async close(): Promise<void> { if (this.state === "closed") return; let failure: Error | null = null; try { await this.agent.close(); } catch (error) { failure = toError(error); } try { await this.usage.flush(); } catch (error) { failure ??= toError(error); } await Promise.all([...this.queueWrites]); failure ??= this.queueError; this.state = "closed"; this.eventQueue.close(); this.output.end(); if (failure) throw failure; }
  events(): AsyncIterable<RuntimeEvent> { return this.eventQueue; }
  stream(): AsyncIterable<string> { return this.output.iterable(); }
  setBoundaryHandler(handler: (boundary: HostBoundary) => Promise<void>): void { this.boundaryHandler = handler; }
  async latestCheckpoint(): Promise<{ taskFingerprint: string; projectVersion: number } | null> { const databaseStore = this.store as StorePort & { latestCheckpoint?: () => Promise<{ taskFingerprint: string; projectVersion: number } | null> }; if (databaseStore.latestCheckpoint) return databaseStore.latestCheckpoint(); const checkpoint = await this.store.checkpoints.latestGlobal(); return checkpoint ? { taskFingerprint: checkpoint.digest ?? "", projectVersion: 1 } : null; }
  snapshot() { const progress = { runtimeState: this.state, recoveryLabel: this.recoveryLabel, usage: this.usage.snapshot(), provider: this.config.provider, model: this.config.model, reflection: this.reflection }; return structuredClone(progress); }
  async replayQueue(maxItems = 100): Promise<RuntimeQueueItem[]> { const items = await this.store.runtime.loadQueue(); return items.slice(-Math.max(0, maxItems)); }
  async importText(path: string): Promise<{ chapters: number }> { const chapters = await importTextFile(path); if (!chapters.length) throw new Error("文本中没有可导入的章节"); for (const chapter of chapters) await this.store.drafts.saveFinalChapter(chapter.chapter, `# ${chapter.title}\n\n${chapter.content}`); const words = chapters.reduce((sum, chapter) => sum + [...chapter.content.replace(/\s/g, "")].length, 0); await this.store.progress.save({ novel_name: "", phase: "writing", current_chapter: chapters.length + 1, total_chapters: chapters.length, completed_chapters: chapters.map((chapter) => chapter.chapter), total_word_count: words, flow: "writing", in_progress_chapter: 0, pending_rewrites: [] }); return { chapters: chapters.length }; }
  export(options: ExportOptions) { return exportNovel(this.store, options); }
  simulate(options: { sources: string[] }) { return simulateSources(options.sources); }

  private hasBudget(): boolean { const limit = this.config.budget?.book_usd ?? 0; return limit <= 0 || this.usage.snapshot().overall.cost_usd < limit; }

  private async run(prompt: string, label: string, externalSignal?: AbortSignal): Promise<void> { if (this.state === "running" || this.state === "closed") throw new Error(`host is ${this.state}`); this.state = "running"; this.runController = new AbortController(); const relayAbort = () => this.runController?.abort(externalSignal?.reason); if (externalSignal?.aborted) relayAbort(); else externalSignal?.addEventListener("abort", relayAbort, { once: true }); this.emit({ ...systemEvent(label), id: `lifecycle:${this.store.dir}:start` }); try { await this.boundary("agent"); const steer = this.pendingSteer.splice(0); const durableSteer = (await this.store.runMeta.load())?.pending_steer.trim(); if (durableSteer && !prompt.includes(durableSteer) && !steer.includes(durableSteer)) steer.push(durableSteer); const effectivePrompt = steer.length ? `${prompt}\n\n用户干预意见：\n${steer.join("\n")}` : prompt; for await (const delta of this.agent.run(effectivePrompt, this.runController.signal)) { this.runController.signal.throwIfAborted(); this.output.write(delta); await this.store.runtime.appendQueue({ seq: 0, time: new Date().toISOString(), kind: "stream_delta", priority: "background", payload: { delta } }); } this.runController.signal.throwIfAborted(); if (durableSteer) await this.store.clearHandledSteer(); await this.boundary("agent"); this.state = "completed"; this.emit({ ...systemEvent("运行完成", "success"), id: `lifecycle:${this.store.dir}:completed` }); } catch (error) { this.state = "paused"; const event = errorEvent(error); this.emit({ ...event, id: `lifecycle:${this.store.dir}:error:${event.message}` }); throw error; } finally { externalSignal?.removeEventListener("abort", relayAbort); this.runController = null; this.output.end(); } }
  private async observeReflection(event: ReflectionEvent & { agent: string }): Promise<void> { const projected = reflectionEvent(event); if (projected.id && this.seenEventIds.has(projected.id)) return; await this.persistEvent(projected); if (projected.id) this.seenEventIds.add(projected.id); this.updateReflection(projected.payload); this.eventQueue.push(projected); }
  private updateReflection(payload: ReflectionRuntimePayload): void { if (payload.phase === "started") this.reflection = { round: 1, maxRounds: payload.maxRounds }; else if (payload.phase === "revision_started") this.reflection = { ...this.reflection, round: payload.round }; else if (payload.phase === "review_completed") this.reflection = { ...this.reflection, round: payload.round, score: payload.score, passed: payload.passed }; else this.reflection = { ...this.reflection, round: payload.rounds, score: payload.score, passed: payload.passed }; }
  private emit(event: RuntimeEvent): void { if (event.id && this.seenEventIds.has(event.id)) return; if (event.id) this.seenEventIds.add(event.id); this.eventQueue.push(event); this.trackQueueWrite(this.store.runtime.appendQueue({ seq: 0, time: event.time ?? new Date().toISOString(), kind: "ui_event", priority: event.type === "error" ? "control" : "background", category: event.type.toUpperCase(), summary: event.message, payload: event })); }
  private persistEvent(event: RuntimeEvent): Promise<void> { return this.store.runtime.appendQueue({ seq: event.sequence ?? 0, time: event.time ?? new Date().toISOString(), kind: "ui_event", priority: event.type === "error" ? "control" : "background", category: event.type.toUpperCase(), summary: event.message, payload: event }).then(() => undefined); }
  private trackQueueWrite(operation: Promise<unknown>): void { let tracked: Promise<void>; tracked = operation.then(() => undefined, (error) => { this.queueError ??= toError(error); }).finally(() => this.queueWrites.delete(tracked)); this.queueWrites.add(tracked); }
  private async boundary(boundary: HostBoundary): Promise<void> { await this.boundaryHandler?.(boundary); }
}

function toError(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)); }
