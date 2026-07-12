export interface RouterProgress {
  phase: string;
  flow?: string;
  completed_chapters?: number[];
  pending_rewrites?: number[];
  layered?: boolean;
}

export interface ArcBoundary {
  isArcEnd?: boolean;
  isVolumeEnd?: boolean;
  volume?: number;
  arc?: number;
  nextVolume?: number;
  nextArc?: number;
  needsExpansion?: boolean;
  needsNewVolume?: boolean;
}

export interface FlowRouterState {
  progress: RouterProgress | null;
  lastCompleted?: number;
  arcBoundary?: ArcBoundary | null;
  hasArcReview?: boolean;
  hasArcSummary?: boolean;
  hasVolumeSummary?: boolean;
  foundationMissing?: string[];
}

export interface Instruction {
  agent: string;
  task: string;
  reason: string;
  chapter: number;
}

export function route(state: FlowRouterState): Instruction | null {
  const progress = state.progress;
  if (progress === null || progress.phase === "complete" || progress.phase !== "writing") return null;

  const pendingRewrites = progress.pending_rewrites ?? [];
  if (pendingRewrites.length > 0) {
    const chapter = pendingRewrites[0];
    if (chapter === undefined) return null;
    const verb = progress.flow === "polishing" ? "打磨" : "重写";
    return { agent: "writer", task: `${verb}第 ${chapter} 章`, reason: `PendingRewrites 队列剩余 ${pendingRewrites.length} 章`, chapter };
  }

  if (progress.flow === "reviewing" || progress.flow === "steering") return null;

  const boundary = state.arcBoundary;
  if (progress.layered === true && boundary?.isArcEnd === true) {
    const volume = boundary.volume ?? 0;
    const arc = boundary.arc ?? 0;
    if (state.hasArcReview !== true) return { agent: "editor", task: `对第 ${volume} 卷第 ${arc} 弧做弧级评审（scope=arc）`, reason: "弧末评审未完成", chapter: 0 };
    if (state.hasArcSummary !== true) return { agent: "editor", task: `生成第 ${volume} 卷第 ${arc} 弧摘要（save_arc_summary）`, reason: "弧摘要未完成", chapter: 0 };
    if (boundary.isVolumeEnd === true && state.hasVolumeSummary !== true) return { agent: "editor", task: `生成第 ${volume} 卷卷摘要（save_volume_summary）`, reason: "卷摘要未完成", chapter: 0 };
    if (boundary.needsExpansion === true && (boundary.nextArc ?? 0) > 0) return { agent: "architect_long", task: `展开第 ${boundary.nextVolume ?? 0} 卷第 ${boundary.nextArc ?? 0} 弧（save_foundation type=expand_arc）`, reason: "下一弧骨架待展开", chapter: 0 };
    if (boundary.needsNewVolume === true) return { agent: "architect_long", task: "创建下一卷：按完结判定清单评估后调用 save_foundation——故事继续 → type=append_volume；故事接近终点 → type=append_volume 且卷 JSON 顶层带 \"final\": true（收官卷，整卷收线，写完自动完结）；全部完结条件当下已满足 → type=complete_book", reason: "卷末需决定追加新卷、收官卷或结束全书", chapter: 0 };
  }

  const nextChapter = Math.max(0, ...(progress.completed_chapters ?? [])) + 1;
  if (nextChapter <= 0) return null;
  return { agent: "writer", task: `写第 ${nextChapter} 章`, reason: "续写下一章", chapter: nextChapter };
}

export function formatMessage(instruction: Instruction): string {
  return `[Host 下达指令]\n下一步：调用 subagent(${instruction.agent}, ${JSON.stringify(instruction.task)})\nagent: ${instruction.agent}\ntask: ${JSON.stringify(instruction.task)}\n理由：${instruction.reason}\n这是流程层的明确指令，请立即执行；subagent 的 agent/task 参数必须原样使用上面的 agent/task，不要改写 task，不要先调 novel_context，不要先输出推理。`;
}
