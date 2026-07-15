import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AuditEventInput, AuditRepositoryLike } from "../audit/repository.js";
import type { RequestAuth } from "../auth/plugin.js";
import type { ProjectMutationResult, ProjectRow } from "./repository.js";
import {
  ProjectMutationService,
  type ProjectMutationRepository,
  type TransactionExecutor,
  type TransactionRunner,
} from "./service.js";
import type { CreateProjectInput, UpdateProjectInput } from "./schemas.js";

interface State {
  projects: Map<string, ProjectRow>;
  audits: AuditEventInput[];
}

type FakeExecutor = TransactionExecutor & {
  state: State;
};

function cloneState(state: State): State {
  return {
    projects: new Map([...state.projects].map(([id, project]) => [id, { ...project }])),
    audits: state.audits.map((event) => ({ ...event })),
  };
}

class FakeTransactionRunner implements TransactionRunner {
  constructor(readonly state: State) {}

  async transaction<T>(callback: (executor: TransactionExecutor) => Promise<T>): Promise<T> {
    const pending = cloneState(this.state);
    const result = await callback({ state: pending } as FakeExecutor);
    this.state.projects = pending.projects;
    this.state.audits = pending.audits;
    return result;
  }
}

class FakeProjectRepository implements ProjectMutationRepository {
  constructor(private readonly executor: FakeExecutor) {}

  async create(auth: RequestAuth, input: CreateProjectInput): Promise<ProjectRow> {
    const now = new Date();
    const project: ProjectRow = {
      id: randomUUID(), userId: auth.userId, title: input.title, status: "active", version: 1,
      archivedAt: null, createdAt: now, updatedAt: now,
    };
    this.executor.state.projects.set(project.id, project);
    return project;
  }

  async update(auth: RequestAuth, projectId: string, input: UpdateProjectInput): Promise<ProjectMutationResult> {
    const project = this.executor.state.projects.get(projectId);
    if (!project || project.userId !== auth.userId) return "missing";
    if (project.version !== input.version) return "conflict";
    const updated = { ...project, title: input.title, version: input.version + 1, updatedAt: new Date() };
    this.executor.state.projects.set(projectId, updated);
    return updated;
  }

  async archive(auth: RequestAuth, projectId: string, version: number): Promise<ProjectMutationResult> {
    const project = this.executor.state.projects.get(projectId);
    if (!project || project.userId !== auth.userId) return "missing";
    if (project.version !== version) return "conflict";
    const now = new Date();
    const archived = { ...project, status: "archived" as const, archivedAt: now, version: version + 1, updatedAt: now };
    this.executor.state.projects.set(projectId, archived);
    return archived;
  }
}

class FailingSuccessAuditRepository implements AuditRepositoryLike {
  constructor(private readonly executor: FakeExecutor) {}

  async write(event: AuditEventInput): Promise<void> {
    if (event.result === "success") throw new Error("injected audit constraint failure");
    this.executor.state.audits.push(event);
  }
}

class RecordingAuditRepository implements AuditRepositoryLike {
  constructor(private readonly state: State) {}

  async write(event: AuditEventInput): Promise<void> {
    this.state.audits.push(event);
  }
}

const auth: RequestAuth = { userId: randomUUID(), role: "user", sessionId: randomUUID() };

function fixtureProject(overrides: Partial<ProjectRow> = {}): ProjectRow {
  const now = new Date();
  return {
    id: randomUUID(), userId: auth.userId, title: "Original", status: "active", version: 1,
    archivedAt: null, createdAt: now, updatedAt: now, ...overrides,
  };
}

function serviceWithFailure(initialProjects: ProjectRow[] = []) {
  const state: State = { projects: new Map(initialProjects.map((project) => [project.id, project])), audits: [] };
  const runner = new FakeTransactionRunner(state);
  const service = new ProjectMutationService(
    runner,
    (executor) => new FakeProjectRepository(executor as FakeExecutor),
    (executor) => new FailingSuccessAuditRepository(executor as FakeExecutor),
  );
  return { service, state };
}

describe("ProjectMutationService", () => {
  it("rolls back create when the success audit insert fails", async () => {
    const { service, state } = serviceWithFailure();

    await expect(service.create(auth, { title: "Draft" }, randomUUID())).rejects.toThrow("audit constraint");

    expect(state.projects.size).toBe(0);
  });

  it("rolls back update when the success audit insert fails", async () => {
    const project = fixtureProject();
    const { service, state } = serviceWithFailure([project]);

    await expect(service.update(auth, project.id, { title: "Changed", version: 1 }, randomUUID())).rejects.toThrow("audit constraint");

    expect(state.projects.get(project.id)).toMatchObject({ title: "Original", version: 1 });
  });

  it("rolls back archive when the success audit insert fails", async () => {
    const project = fixtureProject();
    const { service, state } = serviceWithFailure([project]);

    await expect(service.archive(auth, project.id, 1, randomUUID())).rejects.toThrow("audit constraint");

    expect(state.projects.get(project.id)).toMatchObject({ status: "active", archivedAt: null, version: 1 });
  });

  it.each([
    ["missing" as const, randomUUID(), 1, "not_found" as const],
    ["conflict" as const, fixtureProject().id, 9, "conflict" as const],
  ])("records %s outcomes outside the transaction", async (kind, projectId, version, auditResult) => {
    const project = kind === "conflict" ? fixtureProject({ id: projectId }) : undefined;
    const state: State = { projects: new Map(project ? [[project.id, project]] : []), audits: [] };
    const service = new ProjectMutationService(
      new FakeTransactionRunner(state),
      (executor) => new FakeProjectRepository(executor as FakeExecutor),
      (executor) => new RecordingAuditRepository((executor as FakeExecutor).state),
      new RecordingAuditRepository(state),
    );
    const requestId = randomUUID();

    const result = await service.update(auth, projectId, { title: "Changed", version }, requestId);

    expect(result).toBe(kind);
    expect(state.audits).toEqual([
      expect.objectContaining({ action: "project.update", targetId: projectId, result: auditResult, requestId }),
    ]);
  });
});
