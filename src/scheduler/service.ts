import type { TaskRow } from "./types.js";

export interface TaskClaimer {
  claimNextTask(workerId: string, leaseMs: number): Promise<TaskRow | null>;
}

export class SchedulerService {
  constructor(private readonly repository: TaskClaimer) {}

  claimNextTask(workerId: string, leaseMs: number): Promise<TaskRow | null> {
    if (!workerId.trim()) throw new Error("workerId must not be empty");
    if (!Number.isInteger(leaseMs) || leaseMs <= 0) throw new Error("leaseMs must be a positive integer");
    return this.repository.claimNextTask(workerId, leaseMs);
  }
}
