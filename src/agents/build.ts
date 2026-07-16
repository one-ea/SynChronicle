import type { Config } from "../config/index.js";
import { randomUUID } from "node:crypto";
import { resolveContextWindow } from "../config/index.js";
import type { Bundle } from "../domain/index.js";
import type { ModelSet } from "../providers/index.js";
import { StoreScope, type StorePort, type StagingSession } from "../store/index.js";
import { createToolRegistry, type AskUserHandler } from "../tools/registry.js";
import type { Agent } from "./agent.js";
import type { AgentExecutor, GenerateResult } from "./agent.js";
import { createArchitect } from "./architect.js";
import { ContextManager } from "./context.js";
import { createCoordinator } from "./coordinator.js";
import { createEditor } from "./editor.js";
import { createWriter } from "./writer.js";
import { ReflectiveExecutor, Reviewer, sameTask, type AgentRole, type ReflectionEvent, type ReflectionTask } from "./reflection/index.js";
import { parseReflectionExecutionState } from "./reflection/schemas.js";
import { z } from "zod";

export type UsageRecorder = (agentName: string, usage: unknown, model?: { provider: string; model: string }) => void;
export type FlowBoundaryHook = (toolName: string) => void;
export type GuardBlockHook = (agentName: string, reason: string) => void;
type IntegratedReflectionEvent = ReflectionEvent & { agent: string };
type ReflectionCommitState = z.infer<typeof ReflectionCommitStateSchema>;
const CompletionSchema = z.object({ id: z.string().optional(), sequence: z.number().int().nonnegative().optional(), type: z.literal("reflection.completed"), rounds: z.number().int().nonnegative(), score: z.number(), passed: z.boolean() }).strict();
const ReflectionCommitStateSchema = z.object({ version: z.literal(1), phase: z.enum(["committing", "committed", "completed"]), candidateIds: z.array(z.string()), completion: CompletionSchema, executionId: z.string().optional() }).strict();

function parseCommitState(value: unknown): ReflectionCommitState | null {
  if (value === null) return null;
  const parsed = ReflectionCommitStateSchema.safeParse(value);
  if (!parsed.success) throw new Error(`reflection commit state schema/version invalid: ${parsed.error.message}`);
  return parsed.data;
}

async function deliverCompletion(state: ReflectionCommitState, agent: string, emit?: (event: IntegratedReflectionEvent) => unknown) {
  try { await emit?.({ ...state.completion, agent }); return true; } catch { return false; }
}

export async function recoverReflectionCommit(store: StorePort, staging: StagingSession, agent: string, emit?: (event: IntegratedReflectionEvent) => unknown) {
  const pending = parseCommitState(await staging.loadState());
  if (!pending || pending.phase === "completed") return;
  if (pending.phase === "committing") await store.commitStaged(staging, pending.candidateIds);
  const committed = { ...pending, phase: "committed" as const };
  await staging.saveState(committed);
  if (await deliverCompletion(committed, agent, emit)) await staging.saveState({ ...committed, phase: "completed" });
}

export async function commitReflectionCandidate(store: StorePort, staging: StagingSession, agent: string, candidateIds: string[], completion: Extract<ReflectionEvent, { type: "reflection.completed" }>, emit?: (event: IntegratedReflectionEvent) => unknown, executionId?: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  await staging.saveState({ version: 1, phase: "committing", candidateIds, completion, ...(executionId ? { executionId } : {}) });
  await store.commitStaged(staging, candidateIds);
  const committed = { version: 1 as const, phase: "committed" as const, candidateIds, completion, ...(executionId ? { executionId } : {}) };
  await staging.saveState(committed);
  if (await deliverCompletion(committed, agent, emit)) await staging.saveState({ ...committed, phase: "completed" });
}

export async function coordinateReflectionRecovery(store: StorePort, staging: StagingSession, stateId: string, task: ReflectionTask, agent: string, emit?: (event: IntegratedReflectionEvent) => unknown) {
  await recoverReflectionCommit(store, staging, agent, emit);
  const commit = parseCommitState(await staging.loadState());
  const rawExecution = await store.staging.loadState(stateId);
  const execution = rawExecution === null ? null : parseReflectionExecutionState<GenerateResult>(rawExecution);
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
  store: StorePort,
  models: ModelSet,
  bundle: Bundle,
  recordUsage?: UsageRecorder,
  _onFlowBoundary?: FlowBoundaryHook,
  _onGuardBlock?: GuardBlockHook,
  askUser?: AskUserHandler,
  onReflectionEvent?: (event: IntegratedReflectionEvent) => unknown,
  hasBudget?: () => boolean,
  nextInvocationId?: (input: { agent: string; kind: "generate" | "stream"; logicalKey: string }) => Promise<string>,
  coordinatorTools: readonly (keyof ReturnType<typeof createToolRegistry>)[] = [],
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
  const generation = (role: string) => ({ generationOptions: () => models.currentParameters(role), ...(nextInvocationId ? { nextInvocationId } : {}) });
  const makeExecutor = (name: string, role: AgentRole): AgentExecutor | undefined => {
    if (!reflection.enabled) return undefined;
    return {
      async execute(task, generate, signal) {
        const staging = await store.staging.createSession(`${name}-active`);
        const stateId = `${name}-execution`;
        const recovered = await coordinateReflectionRecovery(store, staging, stateId, task, name, onReflectionEvent);
        if (recovered) return recovered;
        const rawSavedState = await store.staging.loadState(stateId);
        const savedState = rawSavedState === null ? null : parseReflectionExecutionState<GenerateResult>(rawSavedState);
        const executionId = savedState && savedState.status !== "completed" ? savedState.executionId : randomUUID();
        const executor = new ReflectiveExecutor<GenerateResult>({
          executionId,
          stateStore: {
            load: async () => { const value = await store.staging.loadState(stateId); return value === null ? null : parseReflectionExecutionState<GenerateResult>(value); },
            save: (state) => store.staging.saveState(stateId, state),
          },
          role,
          maxRounds: reflection.max_rounds,
          passThreshold: reflection.pass_threshold,
          hasBudget,
          hardStop: cfg.budget?.hard_stop ?? false,
          reviewer: new Reviewer({
            model: models.forReviewerWithHotSwap(),
            generationOptions: () => models.currentParameters("reviewer"),
            ...(nextInvocationId ? { nextInvocationId } : {}),
            retryLimit: reflection.review_retry_limit,
            canContinue: () => !(cfg.budget?.hard_stop ?? false) || (hasBudget?.() ?? true),
            ...usage,
          }),
          emitCompleted: false,
          onEvent: (event) => onReflectionEvent?.({ ...event, agent: name }),
          execute: async (context) => {
            const revisionPrompt = context.round === 1
              ? context.task.objective
              : [context.task.objective, "Previous candidate snapshot:", JSON.stringify(context.previousCandidate ?? null), "Revision instructions:", ...context.revisionInstructions].join("\n");
            const transaction = store.recordingTransaction();
            const output = await storeScope.run(transaction.store, () => generate(revisionPrompt, context.signal, { executionId, round: context.round, operation: "candidate" }));
            context.signal?.throwIfAborted();
            const stagedArtifactIds = await transaction.stage(staging, context.round);
            const artifacts = transaction.artifacts().map((artifact) => ({ target: artifact.target, content: typeof artifact.content === "string" ? artifact.content : new TextDecoder().decode(artifact.content) }));
            return { output, reviewContent: output.text, stagedArtifactIds, artifacts };
          },
        });
        const result = await executor.execute(task, signal);
        signal?.throwIfAborted();
        const candidateIds = result.stagedArtifactIds ?? [];
        const completion: ReflectionEvent = { id: `${executionId}:${result.rounds * 2 + 1}:reflection.completed`, sequence: result.rounds * 2 + 1, type: "reflection.completed", rounds: result.rounds, score: result.finalReview.score, passed: result.finalReview.passed };
        await commitReflectionCandidate(store, staging, name, candidateIds, completion, onReflectionEvent, executionId, signal);
        const rawCompletedState = await store.staging.loadState(stateId);
        const completedState = rawCompletedState === null ? null : parseReflectionExecutionState<GenerateResult>(rawCompletedState);
        if (completedState?.executionId === executionId) await store.staging.saveState(stateId, { ...completedState, status: "completed" });
        return result;
      },
    };
  };
  const coordinatorCtxMgr = makeContext("coordinator");
  const coordinator = createCoordinator(models.forRoleWithFailover("coordinator"), prompt(bundle, "coordinator"), registry, { context: coordinatorCtxMgr, ...generation("coordinator"), ...usage }, coordinatorTools);
  const architectModel = models.forRoleWithFailover("architect");
  const architectShort = createArchitect("architect_short", architectModel, prompt(bundle, "architect-short"), registry, { context: makeContext("architect_short"), executor: makeExecutor("architect_short", "architect"), ...generation("architect"), ...usage });
  const architectLong = createArchitect("architect_long", architectModel, prompt(bundle, "architect-long"), registry, { context: makeContext("architect_long"), executor: makeExecutor("architect_long", "architect"), ...generation("architect"), ...usage });
  const style = cfg.style ? bundle.styles?.[cfg.style] : undefined;
  const writerSystem = [prompt(bundle, "writer"), style].filter(Boolean).join("\n\n");
  const writer = createWriter(models.forRoleWithFailover("writer"), writerSystem, registry, { context: makeContext("writer"), maxSteps: 30, executor: makeExecutor("writer", "writer"), ...generation("writer"), ...usage });
  const editor = createEditor(models.forRoleWithFailover("editor"), prompt(bundle, "editor"), registry, { context: makeContext("editor"), executor: makeExecutor("editor", "editor"), ...generation("editor"), ...usage });
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
