# Task 6 实施报告

## 状态

DONE_WITH_CONCERNS

## 实现

- 新增 PostgreSQL leased scheduler，支持 enqueue、`FOR UPDATE SKIP LOCKED` claim、renew、release 和过期租约恢复。
- claim 事务先获取固定事务级 advisory lock，再恢复过期租约、检查平台并发、用户并发和同作品 write 约束，最后写入 lease owner、到期时间与 attempts。
- 达到最大 attempts 的过期任务转为 failed；其余过期任务恢复 queued。
- 新增租户隔离 run routes，支持 start、pause、resume、abort、steer。
- 命令将 `desiredState` 和 steer 命令持久化到 `runs.resume_data`；重复命令保持幂等，终态或非法 desired state 返回 409。
- run routes 已注册到 Web Server，复用 Task 3 的认证装饰和 Origin 防护。

## RED / GREEN

- RED 1：先创建 scheduler 与 run route 测试，目标测试因 `./repository.js` 和 `./routes.js` 缺失失败。
- GREEN 1：最小实现后内存 route 测试和 scheduler 参数测试通过；PostgreSQL 条件测试完成收集。
- RED 2：新增 abort 后 resume 状态机测试，首次得到 200，预期 409。
- GREEN 2：desired state 为 cancelled 时仅允许重复 abort，测试通过。
- RED 3：新增 Worker 已将 run 状态应用为 cancelled 后重复 abort 测试，首次得到 409，预期 200。
- GREEN 3：实际 cancelled 状态下重复 abort 返回原 run，保持幂等。

## 并发正确性

- 固定事务级 `pg_advisory_xact_lock` 将所有 claimant 的“恢复、计数、选取、领取”临界区串行化，阻止并发 claimant 同时观察旧计数并穿透用户或平台限制。
- 候选任务仍通过 `FOR UPDATE SKIP LOCKED` 领取，保持明确的行锁语义，并为后续更细粒度 scope lock 演进保留路径。
- 用户并发计数覆盖 leased/running；平台计数覆盖 leased/running；同作品 write 同时由事务内检查和 Task 2 partial unique index 双重保护。
- 条件 PostgreSQL 测试覆盖两个并发 claimant 的用户限制、平台限制、同作品 write 限制、lease renew/release 和过期恢复。

## 验证

- 关联测试：34 passed，13 skipped；scheduler 的 5 个 PostgreSQL 用例因 `TEST_DATABASE_URL` 未设置而条件跳过。
- 全量测试：331 passed，21 skipped，共 352 项。
- `pnpm typecheck`：通过。
- `pnpm build`：通过。
- `pnpm exec drizzle-kit check`：通过。
- `pnpm exec drizzle-kit generate`：`No schema changes, nothing to migrate`。
- `git diff --check`：通过。

## 自审

- 所有 run 查询和更新同时绑定 userId、projectId、runId，外部租户资源与缺失资源统一返回 404。
- Zod 校验覆盖 start payload、UUID runId 和 steer instruction；SQL 使用 Drizzle 参数化表达式。
- enqueue 在一个事务内锁定租户所属 active project，并原子创建 run 和初始 task。
- renew 仅允许 lease owner 在未过期 lease 上续约；release 仅允许 owner 对 active lease 执行一次。
- pause/resume/abort/steer 只写 desired state，Worker 可在任务边界应用，符合命令与执行解耦要求。
- 实现范围限定于 scheduler、run routes、server 注册和对应测试，未改动既有 Schema、auth 或 projects 逻辑。

## 提交

- Message: `feat(runtime): add leased task scheduler`
- 本报告随实现提交。

## 顾虑

- 当前环境未设置 `TEST_DATABASE_URL`，真实 PostgreSQL 并发 claimant、advisory lock 和 lease SQL 路径未在本机执行；条件测试需由带隔离 PostgreSQL 的 CI 实际运行。
- 全局 advisory lock 优先保证并发限额正确性，高 claimant 吞吐场景可后续按平台计数行与用户 scope 拆分锁粒度。
- 平台并发当前由 `SchedulerRepository` 构造参数提供，Web Server 使用默认值 4；后续配置任务可接入环境配置。

## 独立审查整改项

- Critical: `releaseLease` 必须要求 lease 未过期，并覆盖过期 release 与 recovery/claim 竞争。
- Important: 移除固定前 100 候选导致的可领取任务饥饿，改为数据库层选择 eligible task 或可证明无饥饿的分页锁定。
- Important: start 使用持久化 idempotency key 和唯一约束，HTTP 重试返回同一 run/task。
- Important: steer 使用稳定 command ID 持久化去重，区分请求重试和用户再次发送相同文本。
- Important: 增加真实 SchedulerRepository command 状态机条件 PostgreSQL 测试。
- Minor: 补 wrong owner、expired renew/release、maxAttempts、running expiry 和 lease race 测试。

## 独立审查整改结果 2026-07-15

### 状态

DONE_WITH_CONCERNS

### 修复

- `releaseLease` 与 claim/recovery 使用同一事务级 advisory lock，并要求 owner 匹配、状态为 leased/running、`lease_expires_at > now`。
- eligible task 改为数据库单候选查询：相关子查询直接约束用户并发和同作品 active write，使用 `LIMIT 1 FOR UPDATE SKIP LOCKED`，消除固定 100 候选窗口。
- eligible selection 要求 `attempts < max_attempts`；claim 恢复阶段将达到上限的 queued 或过期 active 任务转为 failed。
- `runs.idempotency_key` 持久化 start key，`runs_start_idempotency_uq` 唯一索引按 user/project/key 隔离；项目行锁内先查重，再原子创建 run/task。
- start HTTP body 要求 `idempotencyKey`，长度 1-200；同租户同作品重试返回原 run，跨租户可复用同 key。
- steer HTTP body 要求 `commandId` 与 `instruction`；`resume_data.steerCommands` 持久化对象列表并按 command ID 去重，相同文本使用新 ID 时追加新命令。
- 新增迁移 `drizzle/0004_redundant_magma.sql` 及 snapshot/journal，Schema 与迁移同步。

### RED

- 命令：`pnpm vitest run src/db/schema.test.ts src/web/runs/routes.test.ts src/scheduler/scheduler.test.ts`
- 结果：8 failed，6 passed，7 skipped。失败分别证明缺少 idempotency Schema/索引、start/steer 新 HTTP 契约、release expiry SQL 和无饥饿 eligible query。
- 迁移 RED：目标测试中 13 passed，1 failed，7 skipped；失败原因为迁移集合缺少 `runs.idempotency_key` 与 `runs_start_idempotency_uq`。
- maxAttempts RED：`pnpm vitest run src/scheduler/scheduler.test.ts -t "selects one eligible candidate"` 得到 1 failed，SQL 缺少 `attempts < max_attempts`。

### GREEN

- 目标命令：`pnpm vitest run src/scheduler/scheduler.test.ts src/web/runs src/web/auth src/web/projects src/db/schema.test.ts`
- 结果：38 passed，19 skipped，共 57 项；11 个 Scheduler PostgreSQL 用例因 `TEST_DATABASE_URL` 未设置而条件跳过。
- 全量命令：`pnpm test`
- 结果：335 passed，27 skipped，共 362 项。
- `pnpm typecheck`：退出码 0。
- `pnpm build`：退出码 0，CLI/Web/Worker ESM 构建成功。
- `pnpm exec drizzle-kit check`：通过。
- `pnpm exec drizzle-kit generate`：`No schema changes, nothing to migrate`。
- `git diff --check`：退出码 0。

### PostgreSQL 条件覆盖

- 直接调用真实 `SchedulerRepository` 覆盖并发 start 返回同一 run 且仅一条 task、租户 key 隔离。
- 覆盖 wrong owner、expired renew、expired release、release 与 recovery/claim 并发、running lease expiry、maxAttempts failed/recovery。
- 构造 101 个高优先级但受用户并发限制阻塞的 queued task，验证低优先级 eligible task 仍被领取。
- 直接调用 `SchedulerRepository.command()` 覆盖 pause/resume/abort 状态机、租户隔离、steer command ID 去重及相同文本不同 ID。

### 自审

- SQL 全部通过 Drizzle 参数化；HTTP 新字段均由严格 Zod Schema 校验。
- start 唯一索引包含 userId/projectId，避免跨租户幂等键碰撞。
- claim、recovery 与 release 共享 advisory lock 临界区，过期 owner 无法在 recovery 后覆盖新 lease。
- 数据库层只锁定最终 eligible candidate，相关计数子查询不持有前 100 个无关候选行锁。
- 修改范围限定于 Task 6 scheduler/run routes、必要 Schema/migration 及测试。

### 提交

- Message: `fix(runtime): harden scheduler lease semantics`

### 顾虑

- 当前环境未设置 `TEST_DATABASE_URL`，新增 11 个真实 PostgreSQL Scheduler 用例完成收集并明确跳过；数据库运行时证据需由带隔离 PostgreSQL 的 CI 补齐。
- 全局 advisory lock 保证 claim/recovery/release 正确性，并发 claimant 吞吐仍受单临界区约束。
