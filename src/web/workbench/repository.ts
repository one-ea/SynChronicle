import { and, asc, desc, eq, sql, sum } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { chapters, checkpoints, projects, runEvents, runs, tasks, usageRecords } from "../../db/schema/index.js";
import type { RequestAuth } from "../auth/plugin.js";
import type { WorkbenchProjection, WorkbenchRepositoryLike } from "./routes.js";

const emptyUsage: WorkbenchProjection["usage"] = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: "0.00000000", byAgent: [] };

export class WorkbenchRepository implements WorkbenchRepositoryLike {
  constructor(private readonly db: Database) {}

  async get(auth: RequestAuth, projectId: string): Promise<WorkbenchProjection | null> {
    const [project] = await this.db.select({ id: projects.id, userId: projects.userId, title: projects.title, status: projects.status, version: projects.version })
      .from(projects).where(and(eq(projects.userId, auth.userId), eq(projects.id, projectId))).limit(1);
    if (!project) return null;
    const [run] = await this.db.select().from(runs).where(and(eq(runs.userId, auth.userId), eq(runs.projectId, projectId))).orderBy(desc(runs.createdAt)).limit(1);
    if (!run) return { ...project, chapters: [], latestRun: null, agents: [], usage: emptyUsage, pendingQuestion: null };

    const [chapterRows, taskRows, checkpointRows, eventRows, usageRows] = await Promise.all([
      this.db.selectDistinctOn([chapters.sequence], { id: chapters.id, runId: chapters.runId, sequence: chapters.sequence, title: chapters.title, body: chapters.body, status: chapters.status, version: chapters.version })
        .from(chapters).where(and(eq(chapters.userId, auth.userId), eq(chapters.projectId, projectId), eq(chapters.runId, run.id))).orderBy(chapters.sequence, desc(chapters.version)),
      this.db.select({ id: tasks.id, status: tasks.status, leaseVersion: tasks.leaseVersion, type: tasks.type }).from(tasks)
        .where(and(eq(tasks.userId, auth.userId), eq(tasks.projectId, projectId), eq(tasks.runId, run.id))).orderBy(desc(tasks.updatedAt)).limit(1),
      this.db.select({ version: checkpoints.version, state: checkpoints.state, summary: checkpoints.summary }).from(checkpoints)
        .where(and(eq(checkpoints.userId, auth.userId), eq(checkpoints.projectId, projectId), eq(checkpoints.runId, run.id))).orderBy(desc(checkpoints.version)).limit(1),
      this.db.select({ sequence: runEvents.sequence, type: runEvents.type, payload: runEvents.payload }).from(runEvents)
        .where(and(eq(runEvents.userId, auth.userId), eq(runEvents.projectId, projectId), eq(runEvents.runId, run.id))).orderBy(desc(runEvents.sequence)).limit(200),
      this.db.select({ agent: usageRecords.agent, inputTokens: sum(usageRecords.inputTokens), outputTokens: sum(usageRecords.outputTokens), cost: sum(usageRecords.cost) }).from(usageRecords)
        .where(and(eq(usageRecords.userId, auth.userId), eq(usageRecords.projectId, projectId), eq(usageRecords.runId, run.id))).groupBy(usageRecords.agent).orderBy(asc(usageRecords.agent)),
    ]);
    const checkpoint = checkpointRows[0];
    const task = taskRows[0];
    const usage = projectUsage(usageRows);
    return {
      ...project,
      chapters: chapterRows,
      latestRun: { id: run.id, status: run.status, version: checkpoint?.version ?? 0, task: task ? { id: task.id, status: task.status, leaseVersion: task.leaseVersion } : null, checkpointVersion: checkpoint?.version ?? null },
      agents: projectAgents(eventRows, task, checkpoint?.state),
      usage,
      pendingQuestion: pendingQuestion(eventRows),
    };
  }

  async diagnose(auth: RequestAuth, projectId: string, runId: string) {
    const [row] = await this.db.select({ id: runs.id, status: runs.status, checkpointVersion: checkpoints.version, cursor: sql<number>`coalesce(max(${runEvents.sequence}), 0)` })
      .from(runs).leftJoin(checkpoints, and(eq(checkpoints.id, runs.latestCheckpointId), eq(checkpoints.userId, auth.userId)))
      .leftJoin(runEvents, and(eq(runEvents.runId, runs.id), eq(runEvents.userId, auth.userId)))
      .where(and(eq(runs.userId, auth.userId), eq(runs.projectId, projectId), eq(runs.id, runId)))
      .groupBy(runs.id, runs.status, checkpoints.version).limit(1);
    return row ? { summary: `run ${row.status}`, cursor: Number(row.cursor), checkpointVersion: row.checkpointVersion ?? null } : null;
  }
}

export function projectUsage(rows: Array<{ agent: string; inputTokens: string | null; outputTokens: string | null; cost: string | null }>): WorkbenchProjection["usage"] {
  const byAgent = rows.map((row) => {
    const inputTokens = Number(row.inputTokens ?? 0);
    const outputTokens = Number(row.outputTokens ?? 0);
    return { agent: row.agent, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, cost: Number(row.cost ?? 0).toFixed(8) };
  });
  return byAgent.reduce((total, row) => ({ ...total, inputTokens: total.inputTokens + row.inputTokens, outputTokens: total.outputTokens + row.outputTokens, totalTokens: total.totalTokens + row.totalTokens, cost: (Number(total.cost) + Number(row.cost)).toFixed(8) }), { ...emptyUsage, byAgent });
}

function eventBody(event: { payload: unknown }): Record<string, unknown> {
  return event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload as Record<string, unknown> : {};
}

export function projectAgents(events: Array<{ sequence: number; type: string; payload: unknown }>, task: { type: string; status: string } | undefined, checkpointState: unknown): WorkbenchProjection["agents"] {
  const agents = new Map<string, WorkbenchProjection["agents"][number]>();
  for (const event of events) {
    const payload = eventBody(event);
    const name = typeof payload.agent === "string" ? payload.agent : undefined;
    if (name && !agents.has(name)) agents.set(name, { name, state: event.type === "error" ? "error" : event.type, summary: typeof payload.message === "string" ? payload.message : undefined, sequence: event.sequence });
  }
  const state = checkpointState && typeof checkpointState === "object" ? checkpointState as { agents?: unknown } : {};
  if (Array.isArray(state.agents)) for (const candidate of state.agents) {
    if (!candidate || typeof candidate !== "object") continue;
    const row = candidate as Record<string, unknown>;
    if (typeof row.name === "string" && !agents.has(row.name)) agents.set(row.name, { name: row.name, state: typeof row.state === "string" ? row.state : "checkpoint", summary: typeof row.summary === "string" ? row.summary : undefined });
  }
  if (task && !agents.size) agents.set(task.type, { name: task.type, state: task.status });
  return [...agents.values()];
}

function pendingQuestion(events: Array<{ sequence: number; type: string; payload: unknown }>): WorkbenchProjection["pendingQuestion"] {
  for (const event of events) {
    const payload = eventBody(event);
    const argumentsPayload = payload.payload && typeof payload.payload === "object" ? payload.payload as Record<string, unknown> : payload;
    if (event.type !== "tool" || payload.tool !== "ask_user" || !Array.isArray(argumentsPayload.questions)) continue;
    const questions = argumentsPayload.questions.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const row = candidate as Record<string, unknown>;
      return typeof row.header === "string" && typeof row.question === "string" ? [{ header: row.header, question: row.question, options: Array.isArray(row.options) ? row.options.filter((value): value is string => typeof value === "string") : [] }] : [];
    });
    if (questions.length) return { id: `event-${event.sequence}`, questions };
  }
  return null;
}
