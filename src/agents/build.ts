import type { Config } from "../config/index.js";
import { randomUUID } from "node:crypto";
import { resolveContextWindow } from "../config/index.js";
import type { Bundle } from "../domain/index.js";
import type { ModelSet } from "../providers/index.js";
import type { Store } from "../store/index.js";
import { createToolRegistry, type AskUserHandler } from "../tools/registry.js";
import type { Agent } from "./agent.js";
import type { AgentExecutor } from "./agent.js";
import { createArchitect } from "./architect.js";
import { ContextManager } from "./context.js";
import { createCoordinator } from "./coordinator.js";
import { createEditor } from "./editor.js";
import { createWriter } from "./writer.js";
import { ReflectiveExecutor, Reviewer, type AgentRole } from "./reflection/index.js";

export type UsageRecorder = (agentName: string, usage: unknown) => void;
export type FlowBoundaryHook = (toolName: string) => void;
export type GuardBlockHook = (agentName: string, reason: string) => void;

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
): BuiltCoordinator {
  const reflection = cfg.reflection === undefined
    ? { enabled: true, max_rounds: 3, pass_threshold: 85, review_retry_limit: 2 }
    : { enabled: true, max_rounds: 3, pass_threshold: 85, review_retry_limit: 2, ...cfg.reflection };
  const registry = createToolRegistry({ store, askUser });
  const makeContext = (role: string) => {
    const selection = models.currentSelection(role === "architect_short" || role === "architect_long" ? "architect" : role);
    return new ContextManager({ window: resolveContextWindow(cfg, selection.model).window });
  };
  const usage = recordUsage ? { onUsage: recordUsage } : {};
  const makeExecutor = (name: string, role: AgentRole): AgentExecutor | undefined => {
    if (!reflection.enabled) return undefined;
    return {
      async execute(task, generate) {
        const staging = await store.staging.createSession(`${name}-${randomUUID()}`);
        const artifactIds = new WeakMap<object, string>();
        const executor = new ReflectiveExecutor({
          role,
          maxRounds: reflection.max_rounds,
          passThreshold: reflection.pass_threshold,
          reviewer: new Reviewer({
            model: models.forReviewer(),
            retryLimit: reflection.review_retry_limit,
            ...usage,
          }),
          execute: async (context) => {
            const revisionPrompt = context.round === 1
              ? context.task.objective
              : [context.task.objective, "Revision instructions:", ...context.revisionInstructions].join("\n");
            const output = await generate(revisionPrompt);
            const artifact = await staging.stage(context.round, { target: `reflection/${name}.txt`, content: output.text });
            artifactIds.set(output, artifact.id);
            return { output, reviewContent: output.text, stagedArtifactIds: [artifact.id] };
          },
        });
        const result = await executor.execute(task);
        const artifactId = artifactIds.get(result.output);
        if (artifactId) await staging.commit([artifactId]);
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
