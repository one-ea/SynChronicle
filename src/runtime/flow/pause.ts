export const PauseResolution = {
  Keep: "keep",
  Consume: "consume",
  ConsumeAndStop: "consume_and_stop",
} as const;

export type PauseResolution = (typeof PauseResolution)[keyof typeof PauseResolution];

export interface PausePoint {
  after: string;
  reason: string;
}

export interface PauseProgress {
  phase: string;
  pending_rewrites?: number[];
}

export function resolvePausePoint(pausePoint: PausePoint | null, progress: PauseProgress | null): PauseResolution {
  if (pausePoint === null || pausePoint.after !== "rewrites_drained") return PauseResolution.Keep;
  if (progress === null || (progress.pending_rewrites?.length ?? 0) > 0) return PauseResolution.Keep;
  if (progress.phase === "complete") return PauseResolution.Consume;
  return PauseResolution.ConsumeAndStop;
}
