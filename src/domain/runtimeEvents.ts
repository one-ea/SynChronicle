import { z } from "zod";

export const RuntimeQueuePriority = z.enum(["control", "background"]);
export type RuntimeQueuePriority = z.infer<typeof RuntimeQueuePriority>;

export const RuntimeQueueKind = z.enum(["ui_event", "stream_delta", "stream_clear", "control"]);
export type RuntimeQueueKind = z.infer<typeof RuntimeQueueKind>;

export interface RuntimeQueueItem {
  Seq: number;
  Time: string;
  Kind: RuntimeQueueKind;
  Priority: RuntimeQueuePriority;
  TaskID: string;
  Agent: string;
  Category: string;
  Summary: string;
  Payload: unknown;
}

export const RuntimeQueueItemSchema = z.object({
  Seq: z.number().int().nonnegative(),
  Time: z.string(),
  Kind: RuntimeQueueKind,
  Priority: RuntimeQueuePriority,
  TaskID: z.string(),
  Agent: z.string(),
  Category: z.string(),
  Summary: z.string(),
  Payload: z.unknown(),
});

export interface RuntimeTaskLogEntry {
  Time: string;
  TaskID: string;
  Agent: string;
  Event: string;
  Tool: string;
  Summary: string;
  Payload: unknown;
}

export const RuntimeTaskLogEntrySchema = z.object({
  Time: z.string(),
  TaskID: z.string(),
  Agent: z.string(),
  Event: z.string(),
  Tool: z.string(),
  Summary: z.string(),
  Payload: z.unknown(),
});