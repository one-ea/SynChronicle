import type { Config } from "../config/index.js";
import { randomUUID } from "node:crypto";
import { resolveContextWindow } from "../config/index.js";
import type { Bundle } from "../domain/index.js";
import type { ModelSet } from "../providers/index.js";
import { StoreScope, type Store, type StagingSession } from "../store/index.js";
import { createToolRegistry, type AskUserHandler } from "../tools/registry.js";
import type { Agent } from "./agent.js";
import type { AgentExecutor, GenerateResult } from "./agent.js";
import { createArchitect } from "./architect.js";
import { ContextManager } from "./context.js";
import { createCoordinator } from "./coordinator.js";
import { createEditor } from "./editor.js";
import { createWriter } from "./writer.js";
import { ReflectiveExecutor, Reviewer, sameTask, type AgentRole, type ReflectionEvent, type ReflectionExecutionState, type ReflectionTask } from "./reflection/index.js";

export type UsageRecorder = (agentName: string, usage: unknown) => void;
export type FlowBoundaryHook = (toolName: string) => void;
export type GuardBlockHook = (agentName: string, reason: string) => void;
type IntegratedReflectionEvent = ReflectionEvent & { agent: string };
type ReflectionCommitState = { phase: "committing" | "committed" | "completed"; candidateIds: string[]; completion: Extract<ReflectionEvent, { type: "reflection.completed" }>; executionId?: string };

function deliverCompletion(state: ReflectionCommitState, agent: string, emit?: (event: IntegratedReflectionEvent) => void) {
  try { emit?.({ ...state.completion, agent }); return true; } catch { return false; }
}

export async function recoverReflectionCommit(store: Store, staging: StagingSession, agent: string, emit?: (event: IntegratedReflectionEvent) => void) {
  const pending = await staging.loadState<ReflectionCommitState>();
  if (!pending || pending.phase === "completed") return;
  if (pending.phase === "committing") await store.commitStaged(staging, pending.candidateIds);
  const committed = { ...pending, phase: "committed" as const };
  await staging.saveState(committed);
  if (deliverCompletion(committed, agent, emit)) await staging.saveState({ ...committed, phase: "completed" });
}

export async function commitReflectionCandidate(store: Store, staging: StagingSession, agent: string, candidateIds: string[], completion: Extract<ReflectionEvent, { type: "reflection.completed" }>, emit?: (event: IntegratedReflectionEvent) => void, executionId?: string) {
  await staging.saveState({ phase: "committing", candidateIds, completion, ...(executionId ? { executionId } : {}) });
  await store.commitStaged(staging, candidateIds);
  const committed = { phase: "committed" as const, candidateIds, completion, ...(executionId ? { executionId } : {}) };
  await staging.saveState(committed);
  if (deliverCompletion(committed, agent, emit)) await staging.saveState({ ...committed, phase: "completed" });
}

export async function coordinateReflectionRecovery(store: Store, staging: StagingSession, stateId: string, task: ReflectionTask, agent: string, emit?: (event: IntegratedReflectionEvent) => void) {
  await recoverReflectionCommit(store, staging, agent, emit);
  const commit = await staging.loadState<ReflectionCommitState>();
  const execution = await store.staging.loadState<ReflectionExecutionState<GenerateResult>>(stateId);
  if (commit?.phase !== "completed" || execution?.status !== "selected" || !execution.selectedResult) return null;
  if (!sameTask(execution.task, task)) throw new Error("current request does not match persisted reflection task");
  if (commit.executionId && commit.executionId !== execution.executionId) throw new Error("completed reflection commit does not match selected execution");
  const selectedIds = execution.selectedResult.stagedArtifactIds ?? [];
  if (selectedIds.length !== commit.candidateIds.length || selectedIds.some((id, index) => id !== commit.candidateIds[index])) throw new Error("completed reflection commit artifacts do not match selected execution");
  await store.staging.saveState(stateId, { ...execution, status: "completed" });
  return execution.selectedResult;
}

export interface BuiltCoordinator {
  coordinator: Agent;
  agents: Record<"coordinator" | "architect_short" | "architect_long" | "writer" | "editor", Agent>;
  askUser?: AskUserHandler;
  writerRestore: { refresh(): Promise<void>; clear(): void };
  coordinatorCtxMgr: ContextManager;
  applyThinking(role: string, level: string): void;
}

function prompt(bundle: Bundle, name: string): string {
  return bundle.prompts?.[name] ?? bundle.prompts?.[`${name}.md`] ?? "";
}

export function buildCoordinator(
  cfg: Config,
  store: Store,
  models: ModelSet,
  bundle: Bundle,
  recordUsage?: UsageRecorder,
  _onFlowBoundary?: FlowBoundaryHook,
  _onGuardBlock?: GuardBlockHook,
  askUser?: AskUserHandler,
  onReflectionEvent?: (event: IntegratedReflectionEvent) => void,
): BuiltCoordinator {
  const reflection = cfg.reflection === undefined
    ? { enabled: true, max_rounds: 3, pass_threshold: 85, review_retry_limit: 2 }
    : { enabled: true, max_rounds: 3, pass_threshold: 85, review_retry_limit: 2, ...cfg.reflection };
  const storeScope = new StoreScope(store);
  const registry = createToolRegistry({ store: storeScope.store, askUser });
  const makeContext = (role: string) => {
    const selection = models.currentSelection(role === "architect_short" || role === "architect_long" ? "architect" : role);
    return new ContextManager({ window: resolveContextWindow(cfg, selection.model).window });
  };
  const usage = recordUsage ? { onUsage: recordUsage } : {};
  const makeExecutor = (name: string, role: AgentRole): AgentExecutor | undefined => {
    if (!reflection.enabled) return undefined;
    return {
      async execute(task, generate) {
        const staging = await store.staging.createSession(`${name}-active`);
        const stateId = `${name}-execution`;
        const recovered = await coordinateReflectionRecovery(store, staging, stateId, task, name, onReflectionEvent);
        if (recovered) return recovered;
        const savedState = await store.staging.loadState<ReflectionExecutionState<GenerateResult>>(stateId);
        const executionId = savedState && savedState.status !== "completed" ? savedState.executionId : randomUUID();
        const executor = new ReflectiveExecutor<GenerateResult>({
          executionId,
          stateStore: {
            load: () => store.staging.loadState<ReflectionExecutionState<GenerateResult>>(stateId),
            save: (state) => store.staging.saveState(stateId, state),
          },
          role,
          maxRounds: reflection.max_rounds,
          passThreshold: reflection.pass_threshold,
          reviewer: new Reviewer({
            model: models.forReviewer(),
            retryLimit: reflection.review_retry_limit,
            ...usage,
          }),
          emitCompleted: false,
          onEvent: (event) => onReflectionEvent?.({ ...event, agent: name }),
          execute: async (context) => {
            const revisionPrompt = context.round === 1
              ? context.task.objective
              : [context.task.objective, "Revision instructions:", ...context.revisionInstructions].join("\n");
            const transaction = store.recordingTransaction();
            const output = await storeScope.run(transaction.store, () => generate(revisionPrompt));
            const stagedArtifactIds = await transaction.stage(staging, context.round);
            return { output, reviewContent: output.text, stagedArtifactIds };
          },
        });
        const result = await executor.execute(task);
        const candidateIds = result.stagedArtifactIds ?? [];
        const completion: ReflectionEvent = { type: "reflection.completed", rounds: result.rounds, score: result.finalReview.score, passed: result.finalReview.passed };
        await commitReflectionCandidate(store, staging, name, candidateIds, completion, onReflectionEvent, executionId);
        const completedState = await store.staging.loadState<ReflectionExecutionState<GenerateResult>>(stateId);
        if (completedState?.executionId === executionId) await store.staging.saveState(stateId, { ...completedState, status: "completed" });
        return result;
      },
    };
  };
  const coordinatorCtxMgr = makeContext("coordinator");
  const coordinator = createCoordinator(models.forRoleWithFailover("coordinator"), prompt(bundle, "coordinator"), registry, { context: coordinatorCtxMgr, ...usage });
  const architectModel = models.forRoleWithFailover("architect");
  const architectShort = createArchitect("architect_short", architectModel, prompt(bundle, "architect-short"), registry, { context: makeContext("architect_short"), executor: makeExecutor("architect_short", "architect"), ...usage });
  const architectLong = createArchitect("architect_long", architectModel, prompt(bundle, "architect-long"), registry, { context: makeContext("architect_long"), executor: makeExecutor("architect_long", "architect"), ...usage });
  const style = cfg.style ? bundle.styles?.[cfg.style] : undefined;
  const writerSystem = [prompt(bundle, "writer"), style].filter(Boolean).join("\n\n");
  const writer = createWriter(models.forRoleWithFailover("writer"), writerSystem, registry, { context: makeContext("writer"), maxSteps: 30, executor: makeExecutor("writer", "writer"), ...usage });
  const editor = createEditor(models.forRoleWithFailover("editor"), prompt(bundle, "editor"), registry, { context: makeContext("editor"), executor: makeExecutor("editor", "editor"), ...usage });
  const agents = { coordinator, architect_short: architectShort, architect_long: architectLong, writer, editor };
  return {
    coordinator,
    agents,
    askUser,
    writerRestore: { async refresh() {}, clear() {} },
    coordinatorCtxMgr,
    applyThinking() {},
  };
}
