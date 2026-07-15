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
