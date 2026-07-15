import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { projects } from "../../db/schema/index.js";
import type { RequestAuth } from "../auth/plugin.js";
import type { CreateProjectInput, UpdateProjectInput } from "./schemas.js";

export type ProjectRow = typeof projects.$inferSelect;
export type ProjectMutationResult = ProjectRow | "missing" | "conflict";

export class ProjectRepository {
  constructor(private readonly db: Database) {}

  async list(auth: RequestAuth): Promise<ProjectRow[]> {
    return this.db.select().from(projects).where(
      and(eq(projects.userId, auth.userId), eq(projects.status, "active")),
    );
  }

  async get(auth: RequestAuth, projectId: string): Promise<ProjectRow | null> {
    const [project] = await this.db.select().from(projects).where(
      and(eq(projects.userId, auth.userId), eq(projects.id, projectId)),
    ).limit(1);
    return project ?? null;
  }

  async create(auth: RequestAuth, input: CreateProjectInput): Promise<ProjectRow> {
    const [project] = await this.db.insert(projects).values({
      userId: auth.userId,
      title: input.title,
    }).returning();
    if (!project) throw new Error("Project insert returned no row");
    return project;
  }

  async update(
    auth: RequestAuth,
    projectId: string,
    input: UpdateProjectInput,
  ): Promise<ProjectMutationResult> {
    const [project] = await this.db.update(projects).set({
      title: input.title,
      version: input.version + 1,
      updatedAt: new Date(),
    }).where(and(
      eq(projects.userId, auth.userId),
      eq(projects.id, projectId),
      eq(projects.status, "active"),
      eq(projects.version, input.version),
    )).returning();
    if (project) return project;
    return await this.get(auth, projectId) ? "conflict" : "missing";
  }

  async archive(auth: RequestAuth, projectId: string, version: number): Promise<ProjectMutationResult> {
    const now = new Date();
    const [project] = await this.db.update(projects).set({
      status: "archived",
      archivedAt: now,
      version: version + 1,
      updatedAt: now,
    }).where(and(
      eq(projects.userId, auth.userId),
      eq(projects.id, projectId),
      eq(projects.status, "active"),
      eq(projects.version, version),
    )).returning();
    if (project) return project;
    return await this.get(auth, projectId) ? "conflict" : "missing";
  }
}
