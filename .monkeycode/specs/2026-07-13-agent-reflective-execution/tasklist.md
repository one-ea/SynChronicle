# Agent Reflective Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Architect、Writer 和 Editor 的单次任务增加独立 Reviewer 驱动的最多三轮执行、评审和修订闭环。

**Architecture:** 在现有 Agent 外围增加通用 `ReflectiveExecutor`，通过 Adapter 调用原始 Agent，通过无工具的 `ReviewerAgent` 生成 Zod 结构化评审。候选业务工件进入暂存区，最终候选确定后按“业务工件、checkpoint、事件”顺序提交。

**Tech Stack:** Node.js 24 LTS、TypeScript strict、Vercel AI SDK、Zod、Vitest、pnpm 10。

## Global Constraints

- 保持 Coordinator、Flow Router 和现有 Agent 公共调用接口兼容。
- Reviewer 使用独立模型会话且不注册业务工具。
- 默认通过阈值为 85，默认最大轮数为 3，有效轮数范围为 1 至 3。
- 三轮未通过时返回最高分候选，同分选择最新轮次。
- 正式提交顺序固定为“业务工件写入、checkpoint、事件”。
- 旧配置缺少 `reflection` 时可正常加载。
- 每个任务遵循测试先行，并在通过目标测试后独立提交。

---

### Task 1: Reflection 类型、Schema 与配置

**Files:**
- Create: `src/agents/reflection/types.ts`
- Create: `src/agents/reflection/schemas.ts`
- Create: `src/agents/reflection/schemas.test.ts`
- Modify: `src/config/schemas.ts`
- Modify: `src/config/config.test.ts`

**Interfaces:**
- Produces: `AgentRole`, `ReviewIssue`, `ReviewResult`, `ReflectionCandidate<T>`, `QualityRisk`, `ReflectiveResult<T>`。
- Produces: `ReviewResultSchema`、`ReflectionConfigSchema`。
- Produces: `Config["reflection"]`，字段为 `enabled`、`max_rounds`、`pass_threshold`、`review_retry_limit`、`reviewer_model`。

- [x] **Step 1: 编写失败的 Schema 测试**

```ts
it("validates review scores and reflection defaults", () => {
  expect(ReviewResultSchema.parse({
    score: 85,
    passed: false,
    summary: "ready",
    issues: [],
    revisionInstructions: [],
  }).score).toBe(85);

  expect(ConfigSchema.parse(baseConfig).reflection).toEqual({
    enabled: true,
    max_rounds: 3,
    pass_threshold: 85,
    review_retry_limit: 2,
  });
  expect(() => ConfigSchema.parse({
    ...baseConfig,
    reflection: { max_rounds: 4 },
  })).toThrow();
});
```

- [x] **Step 2: 运行测试并确认失败**

Run: `pnpm vitest run src/agents/reflection/schemas.test.ts src/config/config.test.ts`

Expected: FAIL，提示 reflection 模块或配置字段尚未定义。

- [x] **Step 3: 实现最小类型与 Schema**

```ts
export const ReviewIssueSchema = z.object({
  dimension: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]),
  evidence: z.string().min(1),
  recommendation: z.string().min(1),
}).strict();

export const ReviewResultSchema = z.object({
  score: z.number().min(0).max(100),
  passed: z.boolean(),
  summary: z.string(),
  issues: z.array(ReviewIssueSchema),
  revisionInstructions: z.array(z.string().min(1)),
}).strict();

export const ReflectionConfigSchema = z.object({
  enabled: z.boolean().default(true),
  max_rounds: z.number().int().min(1).max(3).default(3),
  pass_threshold: z.number().min(0).max(100).default(85),
  review_retry_limit: z.number().int().min(0).max(3).default(2),
  reviewer_model: z.string().min(1).optional(),
}).default({});
```

在 `ConfigSchema` 中增加 `reflection: ReflectionConfigSchema`，并从 Zod 推导所有公共类型。

- [x] **Step 4: 运行测试并确认通过**

Run: `pnpm vitest run src/agents/reflection/schemas.test.ts src/config/config.test.ts`

Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add src/agents/reflection src/config/schemas.ts src/config/config.test.ts
git commit -m "feat: add reflection schemas and config"
```

### Task 2: Agent 专用评分量表

**Files:**
- Create: `src/agents/reflection/rubrics.ts`
- Create: `src/agents/reflection/rubrics.test.ts`

**Interfaces:**
- Consumes: `AgentRole` from `src/agents/reflection/types.ts`。
- Produces: `ReviewRubric` 和 `getReviewRubric(role, threshold)`。

- [x] **Step 1: 编写失败的量表映射测试**

```ts
it.each([
  ["architect", "因果一致性"],
  ["writer", "情节连贯"],
  ["editor", "证据准确性"],
] as const)("returns the %s rubric", (role, dimension) => {
  const rubric = getReviewRubric(role, 90);
  expect(rubric.threshold).toBe(90);
  expect(rubric.dimensions.map((item) => item.name)).toContain(dimension);
});
```

- [x] **Step 2: 运行测试并确认失败**

Run: `pnpm vitest run src/agents/reflection/rubrics.test.ts`

Expected: FAIL，提示 `getReviewRubric` 尚未定义。

- [x] **Step 3: 实现不可变评分量表**

```ts
export interface ReviewRubric {
  role: AgentRole;
  threshold: number;
  dimensions: ReadonlyArray<{ name: string; weight: number; criteria: string }>;
}

export function getReviewRubric(role: AgentRole, threshold = 85): ReviewRubric {
  return { role, threshold, dimensions: structuredClone(RUBRICS[role]) };
}
```

权重总和固定为 100，并在测试中逐个验证。

- [x] **Step 4: 运行测试并确认通过**

Run: `pnpm vitest run src/agents/reflection/rubrics.test.ts`

Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add src/agents/reflection/rubrics.ts src/agents/reflection/rubrics.test.ts
git commit -m "feat: add role-specific review rubrics"
```

### Task 3: 独立 Reviewer Agent

**Files:**
- Create: `src/agents/reflection/reviewer.ts`
- Create: `src/agents/reflection/reviewer.test.ts`
- Modify: `src/providers/index.ts`

**Interfaces:**
- Consumes: `ReviewRubric`、`ReviewResultSchema`、AI SDK `LanguageModel`。
- Produces: `Reviewer.review(request): Promise<ReviewResult>`。
- Produces: `ReviewRequest`，包含 `objective`、`constraints`、`candidate`、`rubric`、`priorIssues`。

- [x] **Step 1: 编写失败的结构化评审和重试测试**

```ts
it("retries invalid output and recomputes passed from score", async () => {
  const generate = vi.fn()
    .mockResolvedValueOnce({ text: "invalid" })
    .mockResolvedValueOnce({ text: JSON.stringify(validReview({ score: 90, passed: false })) });
  const reviewer = new Reviewer({ generate, retryLimit: 2 });

  const result = await reviewer.review(request);

  expect(generate).toHaveBeenCalledTimes(2);
  expect(result.passed).toBe(true);
});
```

- [x] **Step 2: 运行测试并确认失败**

Run: `pnpm vitest run src/agents/reflection/reviewer.test.ts`

Expected: FAIL，提示 `Reviewer` 尚未定义。

- [x] **Step 3: 实现 Reviewer**

```ts
export class Reviewer {
  async review(request: ReviewRequest): Promise<ReviewResult> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retryLimit; attempt++) {
      try {
        const raw = await this.generate(buildReviewPrompt(request));
        const parsed = ReviewResultSchema.parse(JSON.parse(raw.text));
        return { ...parsed, passed: parsed.score >= request.rubric.threshold };
      } catch (error) {
        lastError = error;
      }
    }
    throw new ReviewerError("review failed", { cause: lastError });
  }
}
```

Reviewer 构建时仅接收模型和生成函数，不接收 Tool Registry。通过 `onUsage("reviewer", usage)` 记录用量。

- [x] **Step 4: 运行测试并确认通过**

Run: `pnpm vitest run src/agents/reflection/reviewer.test.ts`

Expected: PASS，覆盖合法结果、非法 JSON、Schema 错误、重试耗尽和 usage 回调。

- [x] **Step 5: 提交**

```bash
git add src/agents/reflection/reviewer.ts src/agents/reflection/reviewer.test.ts src/providers/index.ts
git commit -m "feat: add independent reviewer agent"
```

### Task 4: Reflective Executor 闭环控制

**Files:**
- Create: `src/agents/reflection/executor.ts`
- Create: `src/agents/reflection/executor.test.ts`
- Create: `src/agents/reflection/index.ts`

**Interfaces:**
- Consumes: `Reviewer.review`、`getReviewRubric`、预算检查和事件回调。
- Produces: `ReflectiveExecutor.execute<T>(task, signal?): Promise<ReflectiveResult<T>>`。
- Execution Adapter: `(context: ExecutionContext) => Promise<ExecutionCandidate<T>>`。

- [ ] **Step 1: 编写失败的闭环测试**

```ts
it("returns the newest highest-scoring candidate after three rounds", async () => {
  const execute = vi.fn()
    .mockResolvedValueOnce(candidate("v1"))
    .mockResolvedValueOnce(candidate("v2"))
    .mockResolvedValueOnce(candidate("v3"));
  const review = vi.fn()
    .mockResolvedValueOnce(reviewResult(70))
    .mockResolvedValueOnce(reviewResult(82))
    .mockResolvedValueOnce(reviewResult(82));

  const result = await createExecutor({ execute, review, maxRounds: 3 }).execute(task);

  expect(result.output).toBe("v3");
  expect(result.rounds).toBe(3);
  expect(result.qualityRisk?.code).toBe("quality_threshold_unmet");
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm vitest run src/agents/reflection/executor.test.ts`

Expected: FAIL，提示 Executor 尚未定义。

- [ ] **Step 3: 实现三轮状态机**

```ts
for (let round = 1; round <= maxRounds; round++) {
  ensureBudget();
  const execution = await execute({ task, round, revisionInstructions, signal });
  const review = await reviewer.review(toReviewRequest(task, execution, rubric, priorIssues));
  candidates.push({ round, output: execution.output, review, stagedArtifactIds: execution.stagedArtifactIds });
  emit({ type: "review.completed", round, score: review.score, passed: review.passed });
  if (review.passed) return finalize(candidates.at(-1)!, candidates);
  revisionInstructions = review.revisionInstructions;
  priorIssues = review.issues;
}
return finalize(selectBestCandidate(candidates), candidates, "quality_threshold_unmet");
```

实现预算耗尽分支、AbortSignal、首轮前事件和最终事件。Reviewer 故障耗尽时保留当前执行错误供 Host 处理，防止无评分候选参与最佳候选选择。

- [ ] **Step 4: 运行测试并确认通过**

Run: `pnpm vitest run src/agents/reflection/executor.test.ts`

Expected: PASS，覆盖首轮通过、后续通过、三轮上限、同分选择、预算耗尽和中止。

- [ ] **Step 5: 提交**

```bash
git add src/agents/reflection
git commit -m "feat: add reflective execution loop"
```

### Task 5: 候选工件暂存与最终提交

**Files:**
- Create: `src/store/staging.ts`
- Create: `src/store/staging.test.ts`
- Modify: `src/store/index.ts`

**Interfaces:**
- Produces: `StagedArtifactStore.createSession()`。
- Produces: `stage(round, artifact)`, `commit(candidateIds)`, `saveState(state)`, `loadState(sessionId)`。
- Consumes: Existing `FileIO.writeFile`、`writeJSON` and Store checkpoint interfaces。

- [ ] **Step 1: 编写失败的隔离和幂等提交测试**

```ts
it("commits only the selected round and can resume idempotently", async () => {
  const staging = await store.staging.createSession("session-1");
  const first = await staging.stage(1, { target: "chapters/01.md", content: "low" });
  const second = await staging.stage(2, { target: "chapters/01.md", content: "best" });

  await staging.commit([second.id]);
  await staging.commit([second.id]);

  expect(await store.drafts.loadChapterText(1)).toContain("best");
  expect(await staging.status(first.id)).toBe("staged");
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm vitest run src/store/staging.test.ts`

Expected: FAIL，提示 `store.staging` 尚未定义。

- [ ] **Step 3: 实现暂存存储**

暂存目录使用 `meta/reflection/<session-id>/round-<n>/`，manifest 记录目标相对路径、内容文件和提交状态。`commit` 逐项调用 FileIO 原子写入，并在每项成功后更新 manifest；恢复时跳过 `committed` 项。

```ts
interface StagedArtifact {
  id: string;
  round: number;
  target: string;
  contentFile: string;
  status: "staged" | "committed";
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `pnpm vitest run src/store/staging.test.ts src/store/store.test.ts`

Expected: PASS，覆盖隔离、最终提交、部分失败恢复和路径越界拒绝。

- [ ] **Step 5: 提交**

```bash
git add src/store/staging.ts src/store/staging.test.ts src/store/index.ts src/store/io.ts
git commit -m "feat: add staged reflection artifacts"
```

### Task 6: Agent 构建与执行集成

**Files:**
- Modify: `src/agents/agent.ts`
- Modify: `src/agents/build.ts`
- Modify: `src/agents/agents.test.ts`
- Modify: `src/agents/architect.ts`
- Modify: `src/agents/writer.ts`
- Modify: `src/agents/editor.ts`

**Interfaces:**
- Consumes: `ReflectiveExecutor`、Reviewer model resolver、Store staging。
- Produces: Architect、Writer、Editor 的兼容 `generate`/`stream` 行为。
- Coordinator 继续使用现有直接执行路径。

- [ ] **Step 1: 编写失败的构建集成测试**

```ts
it("wraps specialist agents and keeps coordinator direct", async () => {
  const built = buildCoordinator(configWithReflection, store, models, bundle, recordUsage);

  expect(built.agents.coordinator.reflectionEnabled).toBe(false);
  expect(built.agents.architect_short.reflectionEnabled).toBe(true);
  expect(built.agents.writer.reflectionEnabled).toBe(true);
  expect(built.agents.editor.reflectionEnabled).toBe(true);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm vitest run src/agents/agents.test.ts`

Expected: FAIL，提示 reflection 状态或包装器尚未接入。

- [ ] **Step 3: 接入执行装饰器**

在 `AgentOptions` 增加可选 `executor`，保留原始 `generate` 和 `stream` 公共签名。抽取无装饰器的私有 `generateDirect(prompt)`，Reflective Executor 通过该函数执行候选，避免递归进入反思闭环。`buildCoordinator` 只为 specialist agents 创建 Executor。

```ts
async generate(prompt: string) {
  if (!this.executor) return this.generateDirect(prompt);
  return this.executor.execute({ objective: prompt }, (revisionPrompt) => this.generateDirect(revisionPrompt));
}
```

流式模式在闭环完成后输出最终候选文本，评审过程通过 Host 事件呈现。

- [ ] **Step 4: 运行测试并确认通过**

Run: `pnpm vitest run src/agents/agents.test.ts src/agents/reflection/*.test.ts`

Expected: PASS，Coordinator 保持直接调用，三个 specialist agents 使用独立闭环。

- [ ] **Step 5: 提交**

```bash
git add src/agents
git commit -m "feat: integrate reflection with specialist agents"
```

### Task 7: Host 事件、Usage 与恢复

**Files:**
- Modify: `src/domain/event.ts`
- Modify: `src/runtime/observer.ts`
- Modify: `src/runtime/usage.ts`
- Modify: `src/runtime/host.ts`
- Modify: `src/runtime/host.test.ts`
- Modify: `src/tui/sidebar.tsx`
- Modify: `src/headless/run.ts`
- Modify: `src/headless/run.test.ts`

**Interfaces:**
- Consumes: Reflection event payloads and persisted reflection session state。
- Produces: 四类 reflection 事件的 RuntimeEvent 投影。
- Produces: `UsageTracker.record("reviewer", usage)` 独立统计。

- [ ] **Step 1: 编写失败的事件顺序和 Usage 测试**

```ts
expect(events.map((event) => event.message)).toEqual([
  "reflection.started",
  "review.completed",
  "revision.started",
  "review.completed",
  "reflection.completed",
]);
expect(host.usage.snapshot().per_agent.reviewer.input).toBeGreaterThan(0);
```

增加恢复测试：checkpoint 位于第一轮评审完成后时，恢复从第二轮开始，且第一轮工件保持暂存状态。

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm vitest run src/runtime/host.test.ts src/runtime/sentinels.test.ts`

Expected: FAIL，提示 reflection 事件和恢复状态尚未接入。

- [ ] **Step 3: 实现运行时投影**

扩展 `RuntimeEventKind` 支持 `reflection`，payload 使用判别字段 `phase`：`started`、`review_completed`、`revision_started`、`completed`。Host 将 Executor 回调写入现有事件队列和 runtime queue；TUI 显示轮次与评分，Headless 输出单行进度。Usage 继续复用 `per_agent`，Reviewer 统一使用键名 `reviewer`。

- [ ] **Step 4: 运行测试并确认通过**

Run: `pnpm vitest run src/runtime src/tui src/headless`

Expected: PASS，事件顺序、Usage 分类和恢复轮次准确。

- [ ] **Step 5: 提交**

```bash
git add src/domain/event.ts src/runtime src/tui src/headless
git commit -m "feat: expose reflection runtime events"
```

### Task 8: 全量回归、文档与交付验证

**Files:**
- Modify: `config.example.jsonc`
- Modify: `README.md`
- Modify: `.monkeycode/specs/2026-07-13-agent-reflective-execution/tasklist.md`

**Interfaces:**
- Validates all requirements and preserves existing public behavior。

- [ ] **Step 1: 添加配置和使用说明**

在 `config.example.jsonc` 增加 `reflection` 示例。README 说明默认三轮、85 分阈值、独立 Reviewer、最佳候选风险返回和成本影响。

- [ ] **Step 2: 运行目标测试**

Run: `pnpm vitest run src/agents/reflection src/agents/agents.test.ts src/store/staging.test.ts src/runtime/host.test.ts`

Expected: PASS。

- [ ] **Step 3: 运行全量静态检查和测试**

Run: `pnpm typecheck && pnpm test && pnpm build`

Expected: typecheck、全部 Vitest 测试和 tsup 构建均成功。

- [ ] **Step 4: 验证打包产物和格式**

Run: `npm pack --dry-run && git diff --check`

Expected: npm 包包含运行时构建产物和文档，Git diff 无空白错误。

- [ ] **Step 5: 更新清单并提交**

将本文件中已验证任务更新为 `[x]`，然后执行：

```bash
git add README.md config.example.jsonc .monkeycode/specs/2026-07-13-agent-reflective-execution/tasklist.md
git commit -m "docs: document reflective agent execution"
```

## Requirement Coverage

- Requirement 1: Tasks 4 and 6
- Requirement 2: Task 3
- Requirement 3: Task 2
- Requirement 4: Task 4
- Requirement 5: Task 5
- Requirement 6: Task 7
- Requirement 7: Tasks 1 and 6
- Requirement 8: Tasks 1 through 8
