import type { RunMeta } from "../domain/index.js";
import type { CastStore } from "./cast.js";
import type { CheckpointStore } from "./checkpoints.js";
import type { DraftStore } from "./drafts.js";
import type { ArtifactInput, StagedArtifactStore, StagingSession } from "./staging.js";
import type { JSONStore, SimulationStore, UsageStore } from "./misc.js";
import type { CharacterStore, OutlineStore } from "./outline.js";
import type { ProgressStore } from "./progress.js";
import type { RuntimeStore } from "./runtime.js";
import type { SessionStore } from "./session.js";
import type { SummaryStore } from "./summaries.js";
import type { WorldStore } from "./world.js";

export interface SignalStorePort {
  saveLastCommit(value: unknown): Promise<void>;
  loadLastCommit(): Promise<unknown>;
  clearLastCommit(): Promise<void>;
  savePendingCommit(value: unknown): Promise<void>;
  loadPendingCommit(): Promise<unknown>;
  clearPendingCommit(): Promise<void>;
  saveLastReview(value: unknown): Promise<void>;
  loadLastReviewSignal(): Promise<unknown>;
  clearLastReview(): Promise<void>;
}

export interface RecordingTransactionPort {
  readonly store: StorePort;
  artifacts(): ArtifactInput[];
  stage(staging: StagingSession, round: number): Promise<string[]>;
}

export interface StorePort {
  readonly dir: string;
  resolveExportPath(filename: string): string;
  readonly progress: ProgressStore;
  readonly outline: OutlineStore;
  readonly drafts: DraftStore;
  readonly summaries: SummaryStore;
  readonly runMeta: JSONStore<RunMeta>;
  readonly userRules: JSONStore<unknown>;
  readonly signals: SignalStorePort;
  readonly runtime: RuntimeStore;
  readonly characters: CharacterStore;
  readonly cast: CastStore;
  readonly world: WorldStore;
  readonly checkpoints: CheckpointStore;
  readonly sessions: SessionStore;
  readonly staging: StagedArtifactStore;
  readonly usage: UsageStore;
  readonly simulation: SimulationStore;
  init(): Promise<void>;
  checkConsistency(): Promise<string[]>;
  foundationMissing(): Promise<string[]>;
  clearHandledSteer(): Promise<void>;
  recordingTransaction(): RecordingTransactionPort;
  writeArtifact(path: string, value: unknown): Promise<void>;
  commitStaged(staging: StagingSession, candidateIds: string[]): Promise<void>;
}
