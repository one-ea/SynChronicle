# Multi-User WebUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留现有 CLI、TUI 和 Headless 行为的基础上，交付可容器部署的多用户 WebUI、独立 Agent Worker 和 PostgreSQL 全量持久化。

**Architecture:** Web 服务采用 Fastify 模块化单体，React + Vite 提供浏览器界面，独立 Worker 通过 PostgreSQL 租约队列执行现有 Host。Drizzle ORM 管理 Schema 与迁移；REST 处理资源与命令，WebSocket 处理可恢复实时事件。

**Tech Stack:** Node.js 24 LTS、TypeScript strict、pnpm 10、Fastify、React 19、Vite 7、Drizzle ORM、PostgreSQL、Argon2id、Vitest、Playwright、Docker Compose。

## Global Constraints

- 保持现有 `synchronicle`、`--headless`、TUI、Host、Coordinator 和 Specialist Agent 公共行为兼容。
- Web、Worker 和 PostgreSQL 为三个部署单元，浏览器只访问 Web 的单个 HTTP 端口。
- PostgreSQL 保存全部用户、作品、工件、任务、checkpoint、事件、usage、额度和加密凭证。
- 所有用户业务查询同时包含授权上下文和资源所有权约束。
- 单用户并发上限可配置，同一作品同一时刻最多运行一个写任务。
- 最终候选、checkpoint、usage 和完成事件在同一数据库事务中提交。
- 用户凭证使用信封加密，明文仅存在于单次 Provider 调用期间。
- 用户模型和平台模型均按实际 Provider 与响应模型统计 usage 和费用。
- 所有功能按 TDD 实施；每项任务通过目标测试、`pnpm typecheck` 和相关回归测试后提交。
- 前端 Vite 开发服务器必须配置 `/api` 和 `/ws` 代理，以及 `allowedHosts: [".monkeycode-ai.online"]`。

---

## Phase 1: Platform Foundation

### Task 1: Web 与 Worker 入口骨架

**Files:**
- Modify: `package.json`
- Modify: `tsup.config.ts`
- Modify: `src/cli/parse.ts`
- Modify: `src/cli/dispatch.ts`
- Create: `src/web/config.ts`
- Create: `src/web/server.ts`
- Create: `src/web/main.ts`
- Create: `src/worker/main.ts`
- Test: `src/web/server.test.ts`
- Test: `src/cli/parse.test.ts`

**Interfaces:**
- Produces: `WebConfigSchema`, `buildWebServer(options)`, `startWebServer()`, `startWorker()`。
- Produces CLI commands: `synchronicle web` and `synchronicle worker`。

- [ ] **Step 1: Write failing entry-point tests**

```ts
it("parses web and worker commands", () => {
  expect(parseCLIOptions(["web"]).command).toBe("web");
  expect(parseCLIOptions(["worker"]).command).toBe("worker");
});

it("serves the health endpoint", async () => {
  const app = await buildWebServer({ databaseUrl: TEST_DATABASE_URL });
  const response = await app.inject({ method: "GET", url: "/api/health" });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ status: "ok" });
  await app.close();
});
```

- [ ] **Step 2: Run tests and verify the missing entry points fail**

Run: `pnpm vitest run src/cli/parse.test.ts src/web/server.test.ts`

Expected: FAIL because `web`, `worker`, or `buildWebServer` is undefined.

- [ ] **Step 3: Add dependencies, scripts, config, and typed server factory**

Add runtime dependencies `fastify`, `fastify-plugin`, `@fastify/cookie`, `@fastify/static`, `@fastify/websocket`, `drizzle-orm`, `postgres`, `argon2`, `react-dom`, and `react-router-dom`. Add development dependencies `vite`, `@vitejs/plugin-react`, `drizzle-kit`, `playwright`, and `@playwright/test`.

```ts
export const WebConfigSchema = z.object({
  host: z.string().default("0.0.0.0"),
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  databaseUrl: z.string().min(1),
  publicUrl: z.string().url(),
  sessionSecret: z.string().min(32),
  credentialMasterKey: z.string().min(32),
  workerId: z.string().min(1).default(() => randomUUID()),
});

export async function buildWebServer(options: WebConfig): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, trustProxy: true });
  app.get("/api/health", async () => ({ status: "ok" as const }));
  return app;
}
```

Add `web` and `worker` to `CLIOptions.command`, dispatch them lazily, and build three tsup entries: `cli/index`, `web/main`, and `worker/main`.

- [ ] **Step 4: Run entry-point verification**

Run: `pnpm vitest run src/cli/parse.test.ts src/web/server.test.ts && pnpm typecheck && pnpm build`

Expected: PASS; `dist/web/main.js` and `dist/worker/main.js` exist.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml tsup.config.ts src/cli src/web src/worker
git commit -m "feat(web): add web and worker entry points"
```

### Task 2: PostgreSQL Schema 与迁移

**Files:**
- Create: `drizzle.config.ts`
- Create: `src/db/client.ts`
- Create: `src/db/schema/auth.ts`
- Create: `src/db/schema/projects.ts`
- Create: `src/db/schema/runtime.ts`
- Create: `src/db/schema/providers.ts`
- Create: `src/db/schema/index.ts`
- Create: `src/db/migrate.ts`
- Create: `src/db/schema.test.ts`
- Create: `drizzle/0000_platform_foundation.sql`

**Interfaces:**
- Produces: `Database`, `createDatabase(databaseUrl)`, `migrateDatabase(databaseUrl)`。
- Produces tables from the design: users, sessions, projects, artifacts, chapters, runs, tasks, run_events, stream_chunks, checkpoints, usage_records, provider_credentials, platform_models, quota_ledger, audit_events。

- [ ] **Step 1: Write failing Schema integration tests**

```ts
it("enforces unique usernames and run event sequences", async () => {
  const db = createDatabase(TEST_DATABASE_URL);
  const user = await fixtures.user(db, { username: "writer" });
  await expect(fixtures.user(db, { username: "writer" })).rejects.toThrow();
  const project = await fixtures.project(db, user.id);
  const run = await fixtures.run(db, project.id, user.id);
  await fixtures.event(db, run.id, 1);
  await expect(fixtures.event(db, run.id, 1)).rejects.toThrow();
});
```

- [ ] **Step 2: Run test and verify missing tables fail**

Run: `pnpm vitest run src/db/schema.test.ts`

Expected: FAIL because Schema and migration modules do not exist.

- [ ] **Step 3: Define enums, tables, indexes, and foreign keys**

Use UUID primary keys, `timestamp with time zone`, JSONB for structured artifacts, text for chapter bodies, and integer event sequences. Define these critical constraints:

```ts
export const runEvents = pgTable("run_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  runId: uuid("run_id").notNull().references(() => runs.id),
  sequence: integer("sequence").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("run_events_run_sequence_uq").on(table.runId, table.sequence),
  index("run_events_user_project_idx").on(table.userId, table.projectId),
]);
```

Add a partial unique index that permits one active write task per project for statuses `leased` and `running`.

- [ ] **Step 4: Generate and execute migration tests**

Run: `pnpm drizzle-kit generate && pnpm vitest run src/db/schema.test.ts && pnpm typecheck`

Expected: PASS; migration creates every required table and constraint.

- [ ] **Step 5: Commit**

```bash
git add drizzle.config.ts drizzle src/db package.json pnpm-lock.yaml
git commit -m "feat(db): add multi-user platform schema"
```

### Task 3: Authentication 与 Session

**Files:**
- Create: `src/web/auth/password.ts`
- Create: `src/web/auth/session.ts`
- Create: `src/web/auth/plugin.ts`
- Create: `src/web/auth/routes.ts`
- Create: `src/web/auth/auth.test.ts`
- Modify: `src/web/server.ts`

**Interfaces:**
- Produces: `hashPassword(password)`, `verifyPassword(hash, password)`, `createSession(db, userId)`, `authenticateRequest(request)`。
- Produces request decoration: `request.auth: { userId: string; role: "user" | "admin"; sessionId: string }`。

- [ ] **Step 1: Write failing authentication tests**

```ts
it("logs in with an opaque refresh cookie and revokes it on logout", async () => {
  const app = await authenticatedTestApp();
  await fixtures.user(app.db, { username: "alice", password: "correct horse battery staple" });
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "alice", password: "correct horse battery staple" } });
  expect(login.statusCode).toBe(200);
  const cookie = login.cookies.find((item) => item.name === "synchronicle_session");
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Strict");
  const logout = await app.inject({ method: "POST", url: "/api/auth/logout", cookies: { synchronicle_session: cookie!.value } });
  expect(logout.statusCode).toBe(204);
});
```

- [ ] **Step 2: Run auth tests and verify failure**

Run: `pnpm vitest run src/web/auth/auth.test.ts`

Expected: FAIL because auth routes are missing.

- [ ] **Step 3: Implement Argon2id and hashed opaque sessions**

```ts
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 });
}

export async function createSession(db: Database, userId: string): Promise<{ id: string; token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const [session] = await db.insert(sessions).values({ userId, tokenHash, expiresAt }).returning();
  return { id: session!.id, token, expiresAt };
}
```

Validate `Origin` for state-changing requests, rate-limit login, return uniform `401` responses, and revoke all sessions after password changes.

- [ ] **Step 4: Run authentication and regression tests**

Run: `pnpm vitest run src/web/auth/auth.test.ts src/cli/parse.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/auth src/web/server.ts
git commit -m "feat(web): add password authentication"
```

### Task 4: Authorization 与作品 CRUD

**Files:**
- Create: `src/web/projects/repository.ts`
- Create: `src/web/projects/routes.ts`
- Create: `src/web/projects/schemas.ts`
- Create: `src/web/projects/projects.test.ts`
- Create: `src/web/audit/repository.ts`
- Modify: `src/web/server.ts`

**Interfaces:**
- Produces: `ProjectRepository.list(auth)`, `get(auth, projectId)`, `create(auth, input)`, `update(auth, projectId, input)`, `archive(auth, projectId)`。
- Consumes: `request.auth` from Task 3 and tables from Task 2。

- [ ] **Step 1: Write cross-user isolation tests**

```ts
it("returns the same response for missing and foreign projects", async () => {
  const { app, alice, bobProject } = await projectTestApp();
  const foreign = await app.inject(authRequest(alice, "GET", `/api/projects/${bobProject.id}`));
  const missing = await app.inject(authRequest(alice, "GET", `/api/projects/${randomUUID()}`));
  expect(foreign.statusCode).toBe(404);
  expect(foreign.body).toBe(missing.body);
});
```

- [ ] **Step 2: Run project tests and verify failure**

Run: `pnpm vitest run src/web/projects/projects.test.ts`

Expected: FAIL because project routes and scoped repository are missing.

- [ ] **Step 3: Implement scoped repository and routes**

```ts
export class ProjectRepository {
  constructor(private readonly db: Database) {}
  async get(auth: AuthContext, projectId: string): Promise<ProjectRow | null> {
    const [project] = await this.db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, auth.userId))).limit(1);
    return project ?? null;
  }
}
```

Every mutation writes an `audit_events` row with request ID, actor, action, target, and result.

- [ ] **Step 4: Run authorization tests**

Run: `pnpm vitest run src/web/projects/projects.test.ts src/web/auth/auth.test.ts && pnpm typecheck`

Expected: PASS, including foreign-resource and archive behavior.

- [ ] **Step 5: Commit**

```bash
git add src/web/projects src/web/audit src/web/server.ts
git commit -m "feat(web): add isolated project management"
```

### Task 5: Store Port 与 PostgreSQL Store Adapter

**Files:**
- Create: `src/store/port.ts`
- Create: `src/store/database/artifacts.ts`
- Create: `src/store/database/runtime.ts`
- Create: `src/store/database/checkpoints.ts`
- Create: `src/store/database/index.ts`
- Create: `src/store/database/database-store.test.ts`
- Modify: `src/store/index.ts`
- Modify: `src/runtime/host.ts`
- Modify: `src/agents/build.ts`

**Interfaces:**
- Produces: `StorePort`, `DatabaseStore`, `DatabaseRecordingTransaction`。
- `HostDependencies.store` changes from concrete `Store` to `StorePort` while `Store` continues implementing `StorePort` for CLI compatibility.

- [ ] **Step 1: Write contract tests shared by file and database stores**

```ts
export function storeContract(name: string, createStore: () => Promise<StorePort>): void {
  describe(name, () => {
    it("round-trips outline, chapter, checkpoint, usage, and runtime events", async () => {
      const store = await createStore();
      await store.outline.savePremise("premise");
      await store.drafts.saveFinalChapter(1, "chapter");
      expect(await store.outline.loadPremise()).toBe("premise");
      expect(await store.drafts.loadChapterText(1)).toBe("chapter");
    });
  });
}
```

- [ ] **Step 2: Run contract test and verify database adapter failure**

Run: `pnpm vitest run src/store/database/database-store.test.ts src/store/store.test.ts`

Expected: FAIL because `DatabaseStore` is missing.

- [ ] **Step 3: Extract the minimum StorePort and implement artifact mapping**

```ts
export interface StorePort {
  readonly progress: Pick<ProgressStore, "load" | "save">;
  readonly outline: Pick<OutlineStore, "loadPremise" | "savePremise" | "loadOutline" | "saveOutline" | "loadLayeredOutline" | "loadCompass">;
  readonly drafts: Pick<DraftStore, "loadChapterText" | "saveFinalChapter">;
  readonly checkpoints: Pick<CheckpointStore, "loadLatest" | "save" | "reload">;
  readonly runtime: Pick<RuntimeStore, "loadQueue" | "appendQueue">;
  readonly usage: Pick<UsageStore, "load" | "save">;
  init(): Promise<void>;
  recordingTransaction(): RecordingTransactionPort;
  commitStaged(staging: StagingSession, candidateIds: string[]): Promise<void>;
}
```

Expand the interface only when current Host and Agent compilation identifies an existing required method. Map logical artifact keys to `artifacts.kind`, `artifacts.text_content`, and `artifacts.json_content`; map chapters to the dedicated `chapters` table.

- [ ] **Step 4: Implement transactional candidate commit**

`DatabaseRecordingTransaction` buffers candidate writes in memory. `commitStaged` executes one Drizzle transaction that writes selected artifacts, checkpoint, usage, and completion event. Add a rollback test that injects a constraint failure and asserts zero selected artifacts are visible.

- [ ] **Step 5: Run store and Host regression tests**

Run: `pnpm vitest run src/store src/runtime/host.test.ts src/agents/agents.test.ts && pnpm typecheck`

Expected: PASS for file and database adapters.

- [ ] **Step 6: Commit**

```bash
git add src/store src/runtime/host.ts src/agents/build.ts
git commit -m "feat(store): add PostgreSQL store adapter"
```

---

## Phase 2: Runtime and Creative Workbench

### Task 6: PostgreSQL 租约队列与并发限制

**Files:**
- Create: `src/scheduler/repository.ts`
- Create: `src/scheduler/service.ts`
- Create: `src/scheduler/types.ts`
- Create: `src/scheduler/scheduler.test.ts`
- Create: `src/web/runs/routes.ts`
- Modify: `src/web/server.ts`

**Interfaces:**
- Produces: `enqueueRun(auth, projectId, input)`, `claimNextTask(workerId, leaseMs)`, `renewLease(taskId, workerId, leaseMs)`, `releaseLease(taskId, workerId, outcome)`。

- [ ] **Step 1: Write concurrency and lease tests**

```ts
it("claims one task once and respects user and project limits", async () => {
  const task = await fixtures.queuedTask(db, { userConcurrency: 1 });
  const first = await repository.claimNextTask("worker-a", 30_000);
  const second = await repository.claimNextTask("worker-b", 30_000);
  expect(first?.id).toBe(task.id);
  expect(second).toBeNull();
});
```

- [ ] **Step 2: Run scheduler tests and verify failure**

Run: `pnpm vitest run src/scheduler/scheduler.test.ts`

Expected: FAIL because the scheduler repository is missing.

- [ ] **Step 3: Implement transactional task claiming**

Inside a database transaction, select an eligible task using `FOR UPDATE SKIP LOCKED`, verify user and platform running counts, then update the task with `leaseOwner`, `leaseExpiresAt`, and `status: "leased"`. Return `null` when no eligible task exists.

```ts
const [candidate] = await tx.select().from(tasks)
  .where(eq(tasks.status, "queued"))
  .orderBy(desc(tasks.priority), asc(tasks.createdAt))
  .limit(1)
  .for("update")
  .skipLocked();
```

- [ ] **Step 4: Add run command routes**

Implement `POST /api/projects/:projectId/runs`, `/pause`, `/resume`, `/abort`, and `/steer`. Commands update persistent desired state; Worker applies them at task boundaries.

- [ ] **Step 5: Run scheduler and route tests**

Run: `pnpm vitest run src/scheduler/scheduler.test.ts src/web/runs && pnpm typecheck`

Expected: PASS, including two concurrent claimant tests.

- [ ] **Step 6: Commit**

```bash
git add src/scheduler src/web/runs src/web/server.ts
git commit -m "feat(runtime): add leased task scheduler"
```

### Task 7: Worker Host 执行与崩溃恢复

**Files:**
- Create: `src/worker/runner.ts`
- Create: `src/worker/commands.ts`
- Create: `src/worker/runner.test.ts`
- Modify: `src/worker/main.ts`
- Modify: `src/runtime/host.ts`

**Interfaces:**
- Produces: `WorkerRunner.runOnce()`, `WorkerRunner.run(signal)`, `executeTask(task, signal)`。
- Consumes: scheduler from Task 6, `DatabaseStore` from Task 5, existing `Host.new()`。

- [ ] **Step 1: Write Worker recovery tests**

```ts
it("recovers an expired task from the latest matching checkpoint", async () => {
  const task = await fixtures.expiredRunningTask(db);
  await fixtures.checkpoint(db, task.runId, { taskFingerprint: task.fingerprint, sequence: 4 });
  await runner.runOnce();
  expect(fakeHost.resume).toHaveBeenCalledOnce();
  expect(await fixtures.taskStatus(db, task.id)).toBe("completed");
});
```

- [ ] **Step 2: Run Worker test and verify failure**

Run: `pnpm vitest run src/worker/runner.test.ts`

Expected: FAIL because `WorkerRunner` is missing.

- [ ] **Step 3: Implement task execution and command polling**

Create a `DatabaseStore` scoped to `userId`, `projectId`, and `runId`; build Host with that store; consume Host events and stream concurrently. Poll desired task state between Agent boundaries. Renew the task lease at one-third of its lease duration.

```ts
export interface WorkerRunnerDependencies {
  scheduler: SchedulerRepository;
  createHost(task: ClaimedTask): Promise<Host>;
  clock?: Pick<typeof globalThis, "setTimeout" | "clearTimeout">;
}
```

- [ ] **Step 4: Preserve durable commit cancellation semantics**

Add a Host boundary callback that marks commit entry and exit. Commands received before entry abort the run; commands received during commit are applied after the transaction completes. Test both boundaries.

- [ ] **Step 5: Run Worker and core runtime tests**

Run: `pnpm vitest run src/worker/runner.test.ts src/runtime/host.test.ts src/agents/reflection && pnpm typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/worker src/runtime/host.ts
git commit -m "feat(worker): execute and recover agent tasks"
```

### Task 8: 实时事件与 WebSocket 断线补发

**Files:**
- Create: `src/realtime/eventRepository.ts`
- Create: `src/realtime/broker.ts`
- Create: `src/web/realtime/routes.ts`
- Create: `src/web/realtime/realtime.test.ts`
- Modify: `src/web/server.ts`
- Modify: `src/worker/runner.ts`

**Interfaces:**
- Produces: `appendEvent(scope, event)`, `listAfter(scope, sequence, limit)`, `publish(event)`, WebSocket `/ws/runs/:runId?after=<sequence>`。

- [ ] **Step 1: Write event authorization and replay tests**

```ts
it("replays missing events in order before live events", async () => {
  await fixtures.events(db, run.id, [1, 2, 3]);
  const socket = await connectRunSocket(app, alice, run.id, 1);
  expect(await socket.nextJson()).toMatchObject({ sequence: 2 });
  expect(await socket.nextJson()).toMatchObject({ sequence: 3 });
  await broker.publish({ runId: run.id, sequence: 4, type: "system", payload: {} });
  expect(await socket.nextJson()).toMatchObject({ sequence: 4 });
});
```

- [ ] **Step 2: Run realtime tests and verify failure**

Run: `pnpm vitest run src/web/realtime/realtime.test.ts`

Expected: FAIL because the route and broker are missing.

- [ ] **Step 3: Implement persistent event sequence allocation**

Allocate the next sequence inside the same transaction as event insertion by locking the run row. Store stream chunks as events with `type: "stream.delta"` and an Agent label. Publish only after transaction commit.

- [ ] **Step 4: Implement authenticated replay and live subscription**

Verify the session and run ownership before WebSocket upgrade. Replay at most 500 events per page until caught up, register the live subscription, query once more to close the replay-subscribe race, and deduplicate by sequence.

- [ ] **Step 5: Run realtime and Worker tests**

Run: `pnpm vitest run src/web/realtime/realtime.test.ts src/worker/runner.test.ts && pnpm typecheck`

Expected: PASS for reconnect, duplicate suppression, and foreign-run rejection.

- [ ] **Step 6: Commit**

```bash
git add src/realtime src/web/realtime src/web/server.ts src/worker/runner.ts
git commit -m "feat(web): stream recoverable run events"
```

### Task 9: React 应用骨架、登录与作品列表

**Files:**
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/web/client/main.tsx`
- Create: `src/web/client/app.tsx`
- Create: `src/web/client/api/client.ts`
- Create: `src/web/client/auth/session.tsx`
- Create: `src/web/client/pages/login.tsx`
- Create: `src/web/client/pages/projects.tsx`
- Create: `src/web/client/styles/tokens.css`
- Create: `src/web/client/styles/global.css`
- Create: `src/web/client/app.test.tsx`
- Modify: `src/web/server.ts`
- Modify: `tsconfig.json`

**Interfaces:**
- Produces browser routes `/login`, `/projects`, `/projects/:projectId`。
- Consumes REST APIs from Tasks 3 and 4。

- [x] **Step 1: Write failing UI tests**

```tsx
it("logs in and renders the current user's projects", async () => {
  server.use(loginSuccess(), projectList([{ id: "p1", title: "雾港来信" }]));
  render(<App />);
  await user.type(screen.getByLabelText("用户名"), "alice");
  await user.type(screen.getByLabelText("密码"), "correct horse battery staple");
  await user.click(screen.getByRole("button", { name: "登录" }));
  expect(await screen.findByText("雾港来信")).toBeVisible();
});
```

- [x] **Step 2: Run UI test and verify failure**

Run: `pnpm vitest run src/web/client/app.test.tsx`

Expected: FAIL because the React application is missing.

- [x] **Step 3: Configure Vite and production static serving**

```ts
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/web/client", emptyOutDir: false },
  server: {
    allowedHosts: [".monkeycode-ai.online"],
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
      "/ws": { target: "ws://localhost:3000", ws: true },
    },
  },
});
```

Fastify serves `dist/web/client` and returns `index.html` for non-API browser routes.

- [x] **Step 4: Implement accessible login and project pages**

Use native forms, visible labels, keyboard focus states, loading states, uniform authentication errors, responsive project cards, and archive filtering. Keep credentials in HttpOnly cookies; browser JavaScript stores no session token.

- [x] **Step 5: Run frontend, API, and build tests**

Run: `pnpm vitest run src/web/client src/web/auth src/web/projects && pnpm typecheck && pnpm build`

Expected: PASS; Vite assets exist under `dist/web/client`.

- [x] **Step 6: Commit**

```bash
git add vite.config.ts index.html tsconfig.json src/web/client src/web/server.ts package.json pnpm-lock.yaml
git commit -m "feat(web): add login and project interface"
```

### Task 10: 三栏创作台与移动导航

**Files:**
- Create: `src/web/client/pages/workbench.tsx`
- Create: `src/web/client/workbench/projectNav.tsx`
- Create: `src/web/client/workbench/activityFeed.tsx`
- Create: `src/web/client/workbench/runSidebar.tsx`
- Create: `src/web/client/workbench/promptInput.tsx`
- Create: `src/web/client/workbench/mobileNav.tsx`
- Create: `src/web/client/realtime/useRunEvents.ts`
- Create: `src/web/client/workbench/workbench.test.tsx`
- Modify: `src/web/client/app.tsx`

**Interfaces:**
- Consumes: `/ws/runs/:runId`, run commands from Task 6, project data from Task 4。
- Produces: desktop three-column workbench and mobile tabbed workbench。

- [ ] **Step 1: Write failing workbench interaction tests**

```tsx
it("renders reflection progress and sends a steering instruction", async () => {
  renderWorkbench({ events: [{ sequence: 1, type: "reflection", payload: { phase: "review_completed", round: 2, maxRounds: 3, score: 88, passed: true } }] });
  expect(screen.getByText("Reviewer · 第 2/3 轮")).toBeVisible();
  expect(screen.getByText("88")).toBeVisible();
  await user.type(screen.getByLabelText("干预指令"), "加强结尾悬念");
  await user.click(screen.getByRole("button", { name: "发送" }));
  expect(api.steer).toHaveBeenCalledWith("加强结尾悬念");
});
```

- [ ] **Step 2: Run workbench tests and verify failure**

Run: `pnpm vitest run src/web/client/workbench/workbench.test.tsx`

Expected: FAIL because workbench components are missing.

- [ ] **Step 3: Implement event reducer and reconnect cursor**

```ts
export interface RunViewState {
  lastSequence: number;
  stream: string;
  events: RuntimeEvent[];
  reflection?: { round?: number; maxRounds?: number; score?: number; passed?: boolean };
}

export function reduceRunEvent(state: RunViewState, event: RuntimeEvent & { sequence: number }): RunViewState {
  if (event.sequence <= state.lastSequence) return state;
  return projectRuntimeEvent({ ...state, lastSequence: event.sequence }, event);
}
```

Reconnect WebSocket using `after=lastSequence` with bounded exponential backoff and a visible connection state.

- [ ] **Step 4: Implement desktop and mobile layouts**

Desktop uses three CSS grid columns. At widths below 768px, render one panel at a time and expose `作品`, `创作`, `状态` bottom navigation. Preserve focus and scroll positions when switching panels.

- [ ] **Step 5: Implement pause, continue, abort, AskUser, model switch, and diagnostics controls**

Map every existing `TuiHost` capability to an explicit button, dialog, or form. Confirm abort operations and show durable-commit waiting state when the server reports a delayed abort.

- [ ] **Step 6: Run workbench and TUI parity tests**

Run: `pnpm vitest run src/web/client/workbench src/tui/tui.test.tsx src/headless && pnpm typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/web/client
git commit -m "feat(web): add realtime creative workbench"
```

---

## Phase 3: Hybrid Model Operations

### Task 11: 用户凭证信封加密

**Files:**
- Create: `src/credentials/envelope.ts`
- Create: `src/credentials/service.ts`
- Create: `src/credentials/credentials.test.ts`
- Create: `src/web/providers/routes.ts`
- Create: `src/web/providers/providers.test.ts`
- Modify: `src/providers/modelset.ts`
- Modify: `src/web/server.ts`

**Interfaces:**
- Produces: `encryptCredential(masterKey, plaintext)`, `decryptCredential(masterKey, envelope)`, `CredentialService.resolve(userId, credentialId)`。
- Consumes existing Provider creation and failover logic without changing actual-model attribution。

- [x] **Step 1: Write encryption and redaction tests**

```ts
it("stores ciphertext and never serializes plaintext", async () => {
  const saved = await service.create(user.id, { provider: "openrouter", apiKey: "secret-value" });
  const row = await fixtures.credentialRow(db, saved.id);
  expect(JSON.stringify(row)).not.toContain("secret-value");
  expect(await service.resolve(user.id, saved.id)).toMatchObject({ apiKey: "secret-value" });
  expect(JSON.stringify(await service.list(user.id))).not.toContain("secret-value");
});
```

- [x] **Step 2: Run credential tests and verify failure**

Run: `pnpm vitest run src/credentials src/web/providers`

Expected: FAIL because encryption and credential routes are missing.

- [x] **Step 3: Implement AES-256-GCM envelope format**

```ts
export interface CredentialEnvelope {
  version: 1;
  algorithm: "aes-256-gcm";
  keyVersion: string;
  wrappedDataKey: string;
  wrapIv: string;
  wrapTag: string;
  ciphertext: string;
  dataIv: string;
  dataTag: string;
}
```

Generate a random data key per credential, encrypt the payload with AES-256-GCM, then encrypt the data key with the versioned master key. Bind `userId`, `credentialId`, and Provider as additional authenticated data.

- [x] **Step 4: Add Provider routes and Worker resolution**

Routes support create, list metadata, replace, disable, and revoke. Worker resolves credentials immediately before Provider construction and releases references after the call. Logs and errors pass through a recursive secret redactor.

- [x] **Step 5: Run credential, Provider, and security regression tests**

Run: `pnpm vitest run src/credentials src/web/providers src/providers && pnpm typecheck`

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/credentials src/web/providers src/providers/modelset.ts src/web/server.ts
git commit -m "feat(security): encrypt user model credentials"
```

### Task 12: 平台模型、额度台账与用户并发配置

**Files:**
- Create: `src/quota/ledger.ts`
- Create: `src/quota/policy.ts`
- Create: `src/quota/quota.test.ts`
- Create: `src/web/usage/routes.ts`
- Create: `src/web/admin/routes.ts`
- Create: `src/web/admin/admin.test.ts`
- Create: `src/web/client/pages/settings.tsx`
- Create: `src/web/client/pages/admin.tsx`
- Modify: `src/runtime/usage.ts`
- Modify: `src/worker/runner.ts`

**Interfaces:**
- Produces: `reserveQuota`, `settleQuota`, `releaseQuota`, `setUserConcurrency`, admin platform-model CRUD。

- [ ] **Step 1: Write atomic quota tests**

```ts
it("settles platform usage exactly once", async () => {
  const reservation = await ledger.reserve(user.id, run.id, 5);
  await ledger.settle(reservation.id, { actualCostUsd: 3.25, usageId: "usage-1" });
  await ledger.settle(reservation.id, { actualCostUsd: 3.25, usageId: "usage-1" });
  expect(await ledger.balance(user.id)).toBe(initialBalance - 3.25);
});
```

- [ ] **Step 2: Run quota tests and verify failure**

Run: `pnpm vitest run src/quota src/web/admin`

Expected: FAIL because quota services are missing.

- [ ] **Step 3: Implement append-only quota ledger**

Use unique idempotency keys derived from `runId + modelCallId + operation`. Reserve estimated cost before a platform-model call, settle actual cost and usage in one transaction, and release unused reservation value.

- [ ] **Step 4: Implement admin and user settings APIs**

Admins can enable platform models, set pricing, assign balances, and cap platform concurrency. Users can set their own concurrency up to the administrator maximum and inspect per-Agent/per-model usage.

- [ ] **Step 5: Build settings and admin pages**

Display credential source, model availability, balance, budget, concurrency, token, cost, latency, and unknown-price warnings. Require confirmation for credential revocation and platform model disabling.

- [ ] **Step 6: Run quota, usage, UI, and scheduler tests**

Run: `pnpm vitest run src/quota src/web/admin src/web/usage src/runtime/usage.test.ts src/scheduler && pnpm typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/quota src/web/admin src/web/usage src/web/client/pages src/runtime/usage.ts src/worker/runner.ts
git commit -m "feat(platform): add model quotas and concurrency controls"
```

### Task 13: 数据库导入导出与现有文件作品迁移

**Files:**
- Create: `src/migration/fileProjectImporter.ts`
- Create: `src/migration/archive.ts`
- Create: `src/migration/migration.test.ts`
- Create: `src/web/projects/importExportRoutes.ts`
- Modify: `src/web/projects/routes.ts`
- Modify: `src/headless/run.ts`

**Interfaces:**
- Produces: versioned export archive manifest, file-store-to-database importer, database project exporter。

- [ ] **Step 1: Write round-trip tests**

```ts
it("imports a file project and exports an equivalent archive", async () => {
  const imported = await importFileProject(db, user.id, fixtureProjectDir);
  const archive = await exportDatabaseProject(db, user.id, imported.projectId);
  expect(await readArchiveManifest(archive)).toMatchObject({ format: "synchronicle-project", version: 1 });
  expect(await readArchiveChapter(archive, 1)).toBe(await readFixtureChapter(1));
});
```

- [ ] **Step 2: Run migration tests and verify failure**

Run: `pnpm vitest run src/migration/migration.test.ts`

Expected: FAIL because archive and importer modules are missing.

- [ ] **Step 3: Implement versioned streaming archive**

The manifest includes format version, project metadata, checksums, artifact index, chapter index, and exported timestamp. Stream uploads and downloads with explicit size limits; validate every archive path and checksum before database insertion.

- [ ] **Step 4: Add import and export routes**

Import creates a new project in a transaction. Export reads a user-scoped snapshot. Preserve existing CLI file export behavior and add a CLI migration command that requires an explicit database URL and target username.

- [ ] **Step 5: Run migration and existing import/export tests**

Run: `pnpm vitest run src/migration src/runtime/exp src/runtime/imp src/headless && pnpm typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/migration src/web/projects src/headless
git commit -m "feat(web): migrate and export database projects"
```

---

## Phase 4: Production Hardening

### Task 14: 容器部署、迁移启动与健康检查

**Files:**
- Create: `Dockerfile`
- Create: `compose.yaml`
- Create: `.dockerignore`
- Create: `scripts/container-entrypoint.sh`
- Create: `.env.web.example`
- Create: `src/web/health/routes.ts`
- Create: `src/web/health/health.test.ts`
- Modify: `README.md`

**Interfaces:**
- Produces container commands: `web`, `worker`, `migrate`。
- Produces health endpoints: `/api/health/live`, `/api/health/ready`。

- [ ] **Step 1: Write health behavior tests**

```ts
it("reports readiness only after database access and migrations succeed", async () => {
  const ready = await app.inject({ method: "GET", url: "/api/health/ready" });
  expect(ready.statusCode).toBe(200);
  database.disable();
  const unavailable = await app.inject({ method: "GET", url: "/api/health/ready" });
  expect(unavailable.statusCode).toBe(503);
});
```

- [ ] **Step 2: Run health tests and verify failure**

Run: `pnpm vitest run src/web/health/health.test.ts`

Expected: FAIL because readiness routes are missing.

- [ ] **Step 3: Implement multi-stage Node.js 24 image**

```dockerfile
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm typecheck && pnpm build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY --from=build /app/package.json /app/pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts/container-entrypoint.sh ./scripts/container-entrypoint.sh
USER node
ENTRYPOINT ["./scripts/container-entrypoint.sh"]
CMD ["web"]
```

- [ ] **Step 4: Add Compose topology**

Compose defines PostgreSQL with a named volume, Web on port 3000, Worker without ports, health checks, restart policies, and environment-file placeholders. Web and Worker depend on successful migration completion.

- [ ] **Step 5: Verify image and deployment documentation**

Run: `docker compose config && docker build -t synchronicle-web:test .`

Expected: Compose validates and image builds. Run container smoke tests against a temporary PostgreSQL instance and assert readiness plus Worker registration.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile compose.yaml .dockerignore scripts/container-entrypoint.sh .env.web.example src/web/health README.md
git commit -m "feat(deploy): add containerized web platform"
```

### Task 15: 安全加固、端到端测试与 CI

**Files:**
- Create: `src/web/security/plugin.ts`
- Create: `src/web/security/security.test.ts`
- Create: `playwright.config.ts`
- Create: `e2e/multi-user-workbench.spec.ts`
- Create: `.github/workflows/web-ci.yml`
- Modify: `src/web/server.ts`
- Modify: `README.md`
- Modify: `.monkeycode/specs/2026-07-15-multi-user-webui/tasklist.md`

**Interfaces:**
- Produces production security headers, request limits, origin checks, audit coverage, E2E verification, and release gate。

- [ ] **Step 1: Write security regression tests**

```ts
it("rejects cross-origin mutations and oversized imports", async () => {
  const csrf = await app.inject({ method: "POST", url: "/api/projects", headers: { origin: "https://attacker.example" }, payload: { title: "x" }, cookies: sessionCookie });
  expect(csrf.statusCode).toBe(403);
  const large = await app.inject({ method: "POST", url: "/api/projects/import", payload: Buffer.alloc(MAX_IMPORT_BYTES + 1), cookies: sessionCookie });
  expect(large.statusCode).toBe(413);
});
```

- [ ] **Step 2: Run security tests and verify failure**

Run: `pnpm vitest run src/web/security/security.test.ts`

Expected: FAIL because security plugin is missing.

- [ ] **Step 3: Implement production security controls**

Set CSP, HSTS in HTTPS deployments, `X-Content-Type-Options`, restrictive frame policy, request body limits, per-route rate limits, trusted proxy configuration, same-origin mutation checks, recursive secret redaction, and role checks for every `/api/admin/*` route.

- [ ] **Step 4: Implement full E2E scenario**

```ts
test("user creates and controls a realtime writing run", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("用户名").fill("alice");
  await page.getByLabel("密码").fill("correct horse battery staple");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("button", { name: "新建作品" }).click();
  await page.getByLabel("作品名称").fill("雾港来信");
  await page.getByRole("button", { name: "创建" }).click();
  await page.getByRole("button", { name: "开始创作" }).click();
  await expect(page.getByText("写作中")).toBeVisible();
  await page.getByRole("button", { name: "暂停" }).click();
  await expect(page.getByText("已暂停")).toBeVisible();
});
```

- [ ] **Step 5: Add CI release gate**

CI starts PostgreSQL, runs migrations, typecheck, all Vitest tests, Vite and tsup builds, Playwright E2E, `npm pack --dry-run`, Docker build, and `docker compose config`.

- [ ] **Step 6: Run final verification**

Run: `pnpm typecheck && pnpm test && pnpm build && pnpm playwright test && npm pack --dry-run && docker compose config`

Expected: all commands pass; existing CLI, TUI, Headless, 277 baseline tests, new Web tests, and E2E tests are green.

- [ ] **Step 7: Mark task list complete and commit**

Update every completed checkbox only after its verification output succeeds.

```bash
git add src/web/security playwright.config.ts e2e .github/workflows/web-ci.yml README.md .monkeycode/specs/2026-07-15-multi-user-webui/tasklist.md
git commit -m "test(web): complete production release gates"
```

## Final Acceptance

- [ ] A user can log in, create and archive projects, and access only owned resources.
- [ ] A user can start, pause, resume, abort, steer, import, export, switch models, and answer Agent questions from WebUI.
- [ ] Desktop and mobile WebUI expose the confirmed workbench layout.
- [ ] User-configurable concurrency and one-write-task-per-project constraints hold under concurrent Worker tests.
- [ ] WebSocket disconnects preserve execution and reconnects replay every missing event once in order.
- [ ] File Store remains compatible with CLI/TUI/Headless; Database Store passes the same contract tests.
- [ ] User credentials remain encrypted at rest and absent from logs, events, responses, and audit payloads.
- [ ] Platform-model quota reservation and settlement are transactional and idempotent.
- [ ] Worker crashes recover from the latest matching checkpoint after lease expiry.
- [ ] Durable commit atomically persists business artifacts, checkpoint, usage, quota settlement, and completion event.
- [ ] `docker compose up` starts PostgreSQL, Web, and Worker; Web readiness succeeds through one exposed port.
- [ ] Typecheck, unit, integration, E2E, build, package, and container verification all pass.
