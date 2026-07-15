import type { Database } from "../../db/client.js";
import { auditEvents } from "../../db/schema/index.js";

export interface AuditEventInput {
  actorId: string;
  action: "project.create" | "project.update" | "project.archive";
  targetId: string | null;
  result: "success" | "invalid" | "not_found" | "conflict" | "error";
  requestId: string;
  metadata?: Record<string, unknown>;
}

export interface AuditRepositoryLike {
  write(event: AuditEventInput): Promise<void>;
}

export class AuditRepository implements AuditRepositoryLike {
  constructor(private readonly db: Database) {}

  async write(event: AuditEventInput): Promise<void> {
    await this.db.insert(auditEvents).values({
      userId: event.actorId,
      action: event.action,
      targetType: "project",
      targetId: event.targetId,
      result: event.result,
      requestId: event.requestId,
      metadata: event.metadata ?? {},
    });
  }
}
