import { randomUUID } from "node:crypto";
import Fastify, { type InjectOptions } from "fastify";
import { describe, expect, it } from "vitest";
import type { RequestAuth } from "../auth/plugin.js";
import type { AuditEventInput, AuditRepositoryLike } from "../audit/repository.js";
import {
  projectRoutes,
  type ProjectRecord,
  type ProjectRepositoryLike,
} from "./routes.js";
import type { CreateProjectInput, UpdateProjectInput } from "./schemas.js";

class MemoryProjectRepository implements ProjectRepositoryLike {
  readonly projects = new Map<string, ProjectRecord>();

  async list(auth: RequestAuth): Promise<ProjectRecord[]> {
    return [...this.projects.values()].filter(
      (project) => project.userId === auth.userId && project.status === "active",
    );
  }

  async get(auth: RequestAuth, projectId: string): Promise<ProjectRecord | null> {
    const project = this.projects.get(projectId);
    return project?.userId === auth.userId ? project : null;
  }

  async create(auth: RequestAuth, input: CreateProjectInput): Promise<ProjectRecord> {
    const now = new Date();
    const project: ProjectRecord = {
      id: randomUUID(),
      userId: auth.userId,
      title: input.title,
      status: "active",
      version: 1,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.projects.set(project.id, project);
    return project;
  }

  async update(
    auth: RequestAuth,
    projectId: string,
    input: UpdateProjectInput,
  ): Promise<"conflict" | "missing" | ProjectRecord> {
    const project = await this.get(auth, projectId);
    if (!project) return "missing";
    if (project.version !== input.version) return "conflict";
    const updated = { ...project, title: input.title, version: project.version + 1, updatedAt: new Date() };
    this.projects.set(project.id, updated);
    return updated;
  }

  async archive(
    auth: RequestAuth,
    projectId: string,
    version: number,
  ): Promise<"conflict" | "missing" | ProjectRecord> {
    const project = await this.get(auth, projectId);
    if (!project) return "missing";
    if (project.version !== version) return "conflict";
    const now = new Date();
    const archived = { ...project, status: "archived" as const, archivedAt: now, version: project.version + 1, updatedAt: now };
    this.projects.set(project.id, archived);
    return archived;
  }
}

class MemoryAuditRepository implements AuditRepositoryLike {
  readonly events: AuditEventInput[] = [];
  async write(event: AuditEventInput): Promise<void> {
    this.events.push(event);
  }
}

async function projectTestApp() {
  const projects = new MemoryProjectRepository();
  const audit = new MemoryAuditRepository();
  const app = Fastify();
  app.decorateRequest("auth");
  app.decorate("authenticateRequest", async (request) => {
    request.auth = {
      userId: String(request.headers["x-user-id"]),
      role: "user",
      sessionId: `session-${request.headers["x-user-id"]}`,
    };
  });
  await app.register(projectRoutes, { prefix: "/api/projects", repository: projects, audit });
  await app.after();
  return { app, projects, audit };
}

function request(
  userId: string,
  method: "GET" | "POST" | "PATCH",
  url: string,
  payload?: Record<string, unknown>,
): InjectOptions {
  return {
    method,
    url,
    headers: { "x-user-id": userId },
    ...(payload ? { payload } : {}),
  };
}

describe("project management", () => {
  it("returns the same response for missing and foreign projects", async () => {
    const { app, projects } = await projectTestApp();
    const bobProject = await projects.create({ userId: "bob", role: "user", sessionId: "bob-session" }, { title: "Bob" });

    const foreign = await app.inject(request("alice", "GET", `/api/projects/${bobProject.id}`));
    const missing = await app.inject(request("alice", "GET", `/api/projects/${randomUUID()}`));

    expect(foreign.statusCode).toBe(404);
    expect(foreign.body).toBe(missing.body);
    await app.close();
  });

  it("isolates lists and cross-user writes", async () => {
    const { app, projects, audit } = await projectTestApp();
    const alice = await projects.create({ userId: "alice", role: "user", sessionId: "a" }, { title: "Alice" });
    await projects.create({ userId: "bob", role: "user", sessionId: "b" }, { title: "Bob" });

    const list = await app.inject(request("alice", "GET", "/api/projects"));
    const foreignUpdate = await app.inject(request("bob", "PATCH", `/api/projects/${alice.id}`, { title: "Stolen", version: 1 }));
    const missingUpdate = await app.inject(request("bob", "PATCH", `/api/projects/${randomUUID()}`, { title: "Stolen", version: 1 }));

    expect(list.json().projects.map((project: ProjectRecord) => project.title)).toEqual(["Alice"]);
    expect(foreignUpdate.statusCode).toBe(404);
    expect(foreignUpdate.body).toBe(missingUpdate.body);
    expect(projects.projects.get(alice.id)?.title).toBe("Alice");
    expect(audit.events.at(-2)).toMatchObject({ actorId: "bob", action: "project.update", targetId: alice.id, result: "not_found" });
    await app.close();
  });

  it("creates, updates, and archives while recording successful audits", async () => {
    const { app, projects, audit } = await projectTestApp();
    const createdResponse = await app.inject(request("alice", "POST", "/api/projects", { title: "Draft" }));
    const created = createdResponse.json().project as ProjectRecord;
    const updatedResponse = await app.inject(request("alice", "PATCH", `/api/projects/${created.id}`, { title: "Novel", version: 1 }));
    const archivedResponse = await app.inject(request("alice", "POST", `/api/projects/${created.id}/archive`, { version: 2 }));
    const list = await app.inject(request("alice", "GET", "/api/projects"));

    expect(createdResponse.statusCode).toBe(201);
    expect(updatedResponse.json().project).toMatchObject({ title: "Novel", version: 2 });
    expect(archivedResponse.json().project).toMatchObject({ status: "archived", version: 3 });
    expect(projects.projects.get(created.id)?.archivedAt).toBeInstanceOf(Date);
    expect(list.json()).toEqual({ projects: [] });
    expect(audit.events).toHaveLength(3);
    expect(audit.events.map(({ actorId, action, targetId, result, requestId }) => ({ actorId, action, targetId, result, requestId }))).toEqual([
      { actorId: "alice", action: "project.create", targetId: created.id, result: "success", requestId: expect.any(String) },
      { actorId: "alice", action: "project.update", targetId: created.id, result: "success", requestId: expect.any(String) },
      { actorId: "alice", action: "project.archive", targetId: created.id, result: "success", requestId: expect.any(String) },
    ]);
    await app.close();
  });

  it("returns 409 and audits optimistic version conflicts", async () => {
    const { app, projects, audit } = await projectTestApp();
    const project = await projects.create({ userId: "alice", role: "user", sessionId: "a" }, { title: "Draft" });

    const response = await app.inject(request("alice", "PATCH", `/api/projects/${project.id}`, { title: "Stale", version: 9 }));

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "Version conflict" });
    expect(audit.events.at(-1)).toMatchObject({ actorId: "alice", action: "project.update", targetId: project.id, result: "conflict" });
    await app.close();
  });

  it("returns identical 404 responses for foreign and missing archives", async () => {
    const { app, projects, audit } = await projectTestApp();
    const project = await projects.create({ userId: "alice", role: "user", sessionId: "a" }, { title: "Private" });

    const foreign = await app.inject(request("bob", "POST", `/api/projects/${project.id}/archive`, { version: 1 }));
    const missing = await app.inject(request("bob", "POST", `/api/projects/${randomUUID()}/archive`, { version: 1 }));

    expect(foreign.statusCode).toBe(404);
    expect(foreign.body).toBe(missing.body);
    expect(projects.projects.get(project.id)?.status).toBe("active");
    expect(audit.events.at(-2)).toMatchObject({
      actorId: "bob",
      action: "project.archive",
      targetId: project.id,
      result: "not_found",
    });
    await app.close();
  });

  it("strictly rejects unknown input fields and audits failed mutations", async () => {
    const { app, audit } = await projectTestApp();

    const response = await app.inject(request("alice", "POST", "/api/projects", { title: "Draft", userId: "bob" }));

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid request" });
    expect(audit.events.at(-1)).toMatchObject({ actorId: "alice", action: "project.create", targetId: null, result: "invalid" });
    await app.close();
  });
});
