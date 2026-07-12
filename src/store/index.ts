import type { RunMeta } from "../domain/index.js";
import { FileIO } from "./io.js";
import { ProgressStore } from "./progress.js";
import { CharacterStore, OutlineStore } from "./outline.js";
import { DraftStore } from "./drafts.js";
import { SummaryStore } from "./summaries.js";
import { CheckpointStore } from "./checkpoints.js";
import { RuntimeStore } from "./runtime.js";
import { WorldStore } from "./world.js";
import { CastStore } from "./cast.js";
import { JSONStore, SimulationStore, UsageStore } from "./misc.js";
import { SessionStore } from "./session.js";

export class Store {
  readonly progress: ProgressStore; readonly outline: OutlineStore; readonly drafts: DraftStore; readonly summaries: SummaryStore; readonly runMeta: JSONStore<RunMeta>; readonly userRules: JSONStore<unknown>; readonly signals: SignalStore; readonly runtime: RuntimeStore; readonly characters: CharacterStore; readonly cast: CastStore; readonly world: WorldStore; readonly checkpoints: CheckpointStore; readonly sessions: SessionStore; readonly usage: UsageStore; readonly simulation: SimulationStore;
  private readonly io: FileIO;
  constructor(readonly dir: string) { this.io = new FileIO(dir); this.progress = new ProgressStore(new FileIO(dir)); this.outline = new OutlineStore(new FileIO(dir)); this.drafts = new DraftStore(new FileIO(dir)); this.summaries = new SummaryStore(new FileIO(dir)); this.runMeta = new JSONStore(new FileIO(dir), "meta/run.json"); this.userRules = new JSONStore(new FileIO(dir), "meta/user_rules.json"); this.signals = new SignalStore(new FileIO(dir)); this.runtime = new RuntimeStore(new FileIO(dir)); this.characters = new CharacterStore(new FileIO(dir)); this.cast = new CastStore(new FileIO(dir)); this.world = new WorldStore(new FileIO(dir)); this.checkpoints = new CheckpointStore(this.io); this.sessions = new SessionStore(new FileIO(dir)); this.usage = new UsageStore(new FileIO(dir)); this.simulation = new SimulationStore(new FileIO(dir)); }
  init() { return this.io.ensureDirs(["chapters", "summaries", "drafts", "reviews", "meta", "meta/runtime", "meta/runtime/tasks", "meta/sessions", "meta/sessions/agents"]); }
  async checkConsistency() { const warnings: string[] = []; const progress = await this.progress.load(); if (!progress) return warnings; const completed = progress.completed_chapters; if (completed.length) { const chapter = completed.at(-1)!; if (!(await this.drafts.loadChapterText(chapter))) warnings.push(`progress 标记第 ${chapter} 章已完成，但 chapters/${String(chapter).padStart(2, "0")}.md 不存在或为空`); } if (progress.layered && progress.current_volume && progress.current_arc) { const volumes = await this.outline.loadLayeredOutline(); if (volumes.length && !volumes.some((v) => v.index === progress.current_volume && v.arcs.some((a) => a.index === progress.current_arc))) warnings.push(`progress 当前 V${progress.current_volume} A${progress.current_arc} 在分层大纲中找不到对应条目`); } return warnings; }
  async foundationMissing() { const missing: string[] = []; if (!(await this.outline.loadPremise())) missing.push("premise"); if (!(await this.outline.loadOutline()).length) missing.push("outline"); if (!(await this.characters.load()).length) missing.push("characters"); if (!(await this.world.loadWorldRules()).length) missing.push("world_rules"); if ((await this.outline.loadLayeredOutline()).length && !(await this.outline.loadCompass())) missing.push("compass"); return missing; }
  async clearHandledSteer() { const meta = await this.runMeta.load(); if (meta?.pending_steer) await this.runMeta.save({ ...meta, pending_steer: "" }); const progress = await this.progress.load(); if (progress?.flow === "steering") await this.progress.save({ ...progress, flow: "writing" }); }
}

class SignalStore {
  constructor(private readonly io: FileIO) {}
  saveLastCommit(value: unknown) { return this.io.writeJSON("meta/last_commit.json", value); }
  loadLastCommit() { return this.io.readJSON("meta/last_commit.json"); }
  clearLastCommit() { return this.io.remove("meta/last_commit.json"); }
  savePendingCommit(value: unknown) { return this.io.writeJSON("meta/pending_commit.json", value); }
  loadPendingCommit() { return this.io.readJSON("meta/pending_commit.json"); }
  clearPendingCommit() { return this.io.remove("meta/pending_commit.json"); }
  saveLastReview(value: unknown) { return this.io.writeJSON("meta/last_review.json", value); }
  loadLastReviewSignal() { return this.io.readJSON("meta/last_review.json"); }
  clearLastReview() { return this.io.remove("meta/last_review.json"); }
}

export * from "./io.js";
export * from "./progress.js";
export * from "./outline.js";
export * from "./drafts.js";
export * from "./summaries.js";
export * from "./checkpoints.js";
export * from "./runtime.js";
export * from "./world.js";
export * from "./cast.js";
export * from "./misc.js";
export * from "./session.js";
