import type { AuditEventInput, AuditRepositoryLike } from "../audit/repository.js";
import type { RequestAuth } from "../auth/plugin.js";
import type {
  DatabaseTransaction,
  ProjectDatabaseExecutor,
  ProjectMutationResult,
  ProjectRow,
} from "./repository.js";
import type { CreateProjectInput, UpdateProjectInput } from "./schemas.js";

export type TransactionExecutor = unknown;

export interface TransactionRunner {
  transaction<T>(callback: (executor: TransactionExecutor) => Promise<T>): Promise<T>;
}

export interface ProjectMutationRepository {
  create(auth: RequestAuth, input: CreateProjectInput): Promise<ProjectRow>;
  update(auth: RequestAuth, projectId: string, input: UpdateProjectInput): Promise<ProjectMutationResult>;
  archive(auth: RequestAuth, projectId: string, version: number): Promise<ProjectMutationResult>;
}

type ProjectRepositoryFactory = (executor: TransactionExecutor) => ProjectMutationRepository;
type AuditRepositoryFactory = (executor: TransactionExecutor) => AuditRepositoryLike;

export function mutationResultAuditResult(
  result: ProjectMutationResult,
): AuditEventInput["result"] {
  if (result === "missing") return "not_found";
  if (result === "conflict") return "conflict";
  return "success";
}

export class ProjectMutationService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly projects: ProjectRepositoryFactory,
    private readonly audits: AuditRepositoryFactory,
    private readonly failureAudit?: AuditRepositoryLike,
  ) {}

  async create(auth: RequestAuth, input: CreateProjectInput, requestId: string): Promise<ProjectRow> {
    return this.runner.transaction(async (executor) => {
      const project = await this.projects(executor).create(auth, input);
      await this.audits(executor).write(this.event(auth, "project.create", project.id, "success", requestId));
      return project;
    });
  }

  async update(
    auth: RequestAuth,
    projectId: string,
    input: UpdateProjectInput,
    requestId: string,
  ): Promise<ProjectMutationResult> {
    const result = await this.runner.transaction(async (executor) => {
      const mutation = await this.projects(executor).update(auth, projectId, input);
      if (typeof mutation !== "string") {
        await this.audits(executor).write(this.event(auth, "project.update", projectId, "success", requestId));
      }
      return mutation;
    });
    await this.auditFailure(auth, "project.update", projectId, result, requestId);
    return result;
  }

  async archive(
    auth: RequestAuth,
    projectId: string,
    version: number,
    requestId: string,
  ): Promise<ProjectMutationResult> {
    const result = await this.runner.transaction(async (executor) => {
      const mutation = await this.projects(executor).archive(auth, projectId, version);
      if (typeof mutation !== "string") {
        await this.audits(executor).write(this.event(auth, "project.archive", projectId, "success", requestId));
      }
      return mutation;
    });
    await this.auditFailure(auth, "project.archive", projectId, result, requestId);
    return result;
  }

  private async auditFailure(
    auth: RequestAuth,
    action: AuditEventInput["action"],
    targetId: string,
    result: ProjectMutationResult,
    requestId: string,
  ): Promise<void> {
    if (typeof result !== "string") return;
    if (!this.failureAudit) throw new Error("Project mutation failure audit repository is required");
    await this.failureAudit.write(this.event(auth, action, targetId, mutationResultAuditResult(result), requestId));
  }

  private event(
    auth: RequestAuth,
    action: AuditEventInput["action"],
    targetId: string,
    result: AuditEventInput["result"],
    requestId: string,
  ): AuditEventInput {
    return { actorId: auth.userId, action, targetId, result, requestId };
  }
}

export function databaseTransactionRunner(
  database: { transaction<T>(callback: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> },
): TransactionRunner {
  return {
    transaction: (callback) => database.transaction((transaction) => callback(transaction)),
  };
}

export function asProjectExecutor(executor: TransactionExecutor): ProjectDatabaseExecutor {
  return executor as ProjectDatabaseExecutor;
}
