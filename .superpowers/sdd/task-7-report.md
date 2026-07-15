# Task 7 实施报告

## 状态

完成独立 Worker 执行器、租约续期、Host/Coordinator 边界接入、控制命令、checkpoint 恢复、lease fencing、错误持久化、受控循环和 graceful shutdown。

## RED / GREEN

- RED: `pnpm vitest run src/worker/runner.test.ts src/runtime/host.test.ts`
- RED 结果: `WorkerRunner` 模块缺失；`Host.setBoundaryHandler` 缺失。
- GREEN: `pnpm vitest run src/worker/runner.test.ts src/runtime/host.test.ts src/agents/reflection`
- GREEN 结果: 6 个文件、81 个测试通过。

## 恢复和幂等证明

- Worker 只在最新 checkpoint 的 `taskFingerprint` 与当前任务类型和 payload 指纹一致时调用 `Host.resume()`。
- 过期 lease 由 Scheduler 重新排队并增加 attempt；新 Worker 从匹配 checkpoint 恢复。
- durable commit 入口先续租验证 owner；lease 丢失时事务提交前中止。
- Host 关闭并 flush usage 后再次验证 lease，随后原子提交 task/run 终态。
- steer command 按 command ID 应用并从待处理列表确认移除，重复轮询不会重复执行。
- 相同 usage 快照跳过重复写入；反射事件继续使用事件 ID 去重；checkpoint 恢复避免重复章节提交。
- pause/abort 在 agent 边界立即生效；commit 期间收到的命令在 `commit:exit` 后处理。

## 自审

- Worker 长循环拆分为可测试的 `runOnce()` 和受信号控制的 `run()`。
- retryable 错误重新排队，终态错误标记 failed，pause/abort 映射到对应任务和 run 状态。
- Worker 错误作为 run event 持久化，并受有效 lease owner 条件保护。
- CLI 使用 `SIGINT`/`SIGTERM` 触发 AbortController，清理信号监听器。
- Drizzle schema 无变更，generate 未产生迁移文件。

## 验证

- 目标测试: 81 passed。
- 全量测试: 348 passed, 29 skipped。
- `pnpm typecheck`: passed。
- `pnpm build`: passed。
- `pnpm exec drizzle-kit check`: passed。
- `pnpm exec drizzle-kit generate`: no schema changes。
- `git diff --check`: passed。

## 提交

- `feat(worker): execute leased writing runs`，本报告随该提交入库。

## 顾虑

- PostgreSQL 集成测试依赖 `TEST_DATABASE_URL`，当前环境跳过 29 个数据库相关测试；内存合同测试、SQL 构造测试和全量非 PostgreSQL 测试均通过。

## 独立审查整改项

- Critical: durable commit 必须在同一数据库事务中锁定并校验 task lease owner/expiry，提供真正 fencing。
- Critical: resume 必须将 paused task 重新排队并可恢复执行。
- Important: checkpoint 恢复同时校验任务指纹和作品版本。
- Important: shutdown 信号需传播到运行中 Host/provider 调用。
- Important: steer command 使用数据库持久 claim/applied 状态实现崩溃安全去重。
- Important: 错误按瞬时、输入、配置、lease loss、取消和内部错误分类。
- Important: usage 使用稳定 snapshot ID 与数据库唯一约束/upsert 幂等。
- Important: 增加真实 PostgreSQL 双 Worker、commit 中途 lease loss、pause/resume、crash recovery 条件测试。
- Minor: 控制事件与错误事件分离，检查所有 fencing 返回值，生命周期事件使用稳定幂等 ID。

## 整改 RED / GREEN

- RED 1: `pnpm vitest run src/db/schema.test.ts src/store/database/database-store.test.ts`，缺少 `lease_version`、`run_commands`、`snapshot_id`、stable event ID、Memory fencing API 和 project version checkpoint。
- GREEN 1: Memory Store 合同通过，旧 lease 无法写章节、checkpoint、usage、event；checkpoint 返回真实 task fingerprint 和 project version。
- RED 2: `pnpm vitest run src/worker/runner.test.ts`，恢复 API、project version、AbortSignal、durable steer claim/ack 和 fencing 返回值处理缺失。
- GREEN 2: Worker/Host 目标测试通过，覆盖版本不匹配安全重启、SIGTERM 类中止、steer crash window、pause commit 边界和所有 finish/record 返回值。
- RED 3: Host events/stream 未消费，`drains Host events and stream while executing` 失败。
- GREEN 3: Worker 并发 drain Host events/stream，并在 Host close 后等待 drain 完成。

## 整改设计证明

- task 每次 claim 原子递增 `lease_version`。Worker Store scope 固定携带 task ID、owner、lease version 和 project version。
- `DatabaseBackend.transaction(scope, operation)` 在 PostgreSQL 同一事务内 `FOR UPDATE` 锁 task 行，验证 owner、lease version、active status、expiry，并验证项目当前版本；durable staging commit、章节、checkpoint、usage 和 event 均通过该入口。
- Memory backend 实现相同 lease version 合同，测试模拟 worker-a 被 worker-b reclaim 后全部 durable 写入被拒绝。
- pause 将 queued task 原子改为 paused；运行中 task 在 Worker agent 边界通过 fenced finish 持久为 paused。resume 在 run 事务内将 paused task 原子恢复 queued，保留 checkpoint，重复命令幂等。
- checkpoint 写入 claim 时读取的真实 `projects.version`；恢复要求 task fingerprint 和 project version 同时匹配。
- Host 将外部 AbortSignal 连接到内部 controller/provider signal；shutdown 立即停止续租、abort Host，并让 lease expiry 后由其他 Worker reclaim。
- steer 使用 `run_commands` pending/claimed/applied 状态和 lease version claim。Host 通过 fenced transaction 原子写入 run meta pending steer 与 durable command marker；ack crash window 可由新 Worker reclaim，Host marker 防止重复应用。
- usage snapshot ID 仅哈希计费状态，排除 `updated_at`；数据库唯一约束 `(run_id, snapshot_id)` 并使用 upsert，migration 回填历史行后设置非空。
- Worker 错误分类为 transient、invalid_input、invalid_config、lease_loss、cancel、internal，并结合 attempt 上限决定 retryable。
- WORKER.CONTROL 与 WORKER.ERROR 分离；控制、错误和 Host lifecycle 均使用稳定 ID，重复持久化由唯一约束抑制。

## PostgreSQL 条件测试

- 双 Worker claim、lease expiry/reclaim、旧 Worker durable commit 拒绝、pause/resume 幂等、steer claim crash recovery、usage 并发 upsert 均有 `TEST_DATABASE_URL` 条件测试。
- 当前环境未提供 `TEST_DATABASE_URL` 时，这些测试保持 skip；Memory 合同持续执行同等核心语义。

## 整改提交

- `fix(worker): fence durable run execution`，本报告随整改提交入库。

## 整改验证证据

- 目标测试: 10 files passed，119 passed，27 PostgreSQL 条件测试 skipped。
- 全量测试: 48 files passed，2 files skipped；365 passed，33 skipped。
- `pnpm typecheck`: passed。
- `pnpm build`: passed，CLI/Web/Worker 三入口构建成功。
- `pnpm exec drizzle-kit check`: passed。
- `pnpm exec drizzle-kit generate`: no schema changes。
- `git diff --check`: passed。
- 首次将全量测试与 build/Drizzle 并行执行时，Argon2 用例因 CPU 争用触发 20 秒测试超时；独立重跑全量测试后 365 tests passed。

## 最后一轮整改 RED / GREEN

- RED: `pnpm vitest run src/worker/runner.test.ts src/runtime/host.test.ts`。
- RED 结果: marker/run meta 已持久化，但 reclaim Host 的 `startPrepared()` prompt 未包含 durable pending steer；重复 provider failure 生成两个无稳定 ID 的 error lifecycle event。
- GREEN: reclaim Worker 使用真实 Host 和共享 DatabaseStore backend，模拟 marker 写入后、command ack 前崩溃；新 Host 最终向 Agent prompt 投递一次 steer 并 ack。error lifecycle 使用稳定 ID，恢复重试只保留一条。
- PostgreSQL 条件测试新增 transaction barrier：Worker A fenced transaction 已锁 task 行后跨越 lease expiry，Worker B claim 保持阻塞；A commit 后 B 才 reclaim，lease version 递增且章节只提交一次。
- PostgreSQL 条件测试新增 checkpoint crash recovery 端到端：真实 checkpoint、expired lease、reclaim、fingerprint/project version、`Host.resume()`、chapter/usage/event 唯一性串联验证。
- 删除无调用方且缺少 lease version fencing 的旧 `SchedulerRepository.applySteerCommands()`。

## 最后一轮恢复证明

- Host 在 agent 边界同时读取进程内 steer 与 `runMeta.pending_steer`。marker 已存在时 `Host.steer()` 保持幂等，durable pending 仍进入 prompt；成功执行后清除 pending，marker 保留用于 crash replay 判定。
- command 在 ack 后、provider 调用前崩溃时，run meta pending 仍由下一 Host 自动投递；provider 成功后、ack 前崩溃时，下一 Worker 可 reclaim command，marker 阻止重复写入，已清理 pending 表示投递完成。
- error lifecycle ID 由 Store scope 与错误消息确定，文件 Store 使用恢复时 seen-ID 去重，DatabaseStore 使用 `(run_id, stable_id)` 唯一约束去重。

## 最后一轮测试证据

- 目标测试: 6 files passed，1 PostgreSQL file skipped；60 passed，29 skipped。
- PostgreSQL 条件测试仅在 `TEST_DATABASE_URL` 存在时执行，包括 transaction lock barrier 与 checkpoint crash recovery。
- 全量测试: 48 files passed，3 conditional files skipped；367 passed，35 skipped。
- `pnpm typecheck`、`pnpm build`、`pnpm exec drizzle-kit check`、`pnpm exec drizzle-kit generate`、`git diff --check` 全部通过。
- 提交: `fix(worker): complete crash recovery delivery`，本报告随提交入库。

## Steer Exactly-Once 整改

- RED: 同一 agent boundary 输入 `Direction A`、`Direction B` 时，旧实现同时拼接内存单条列表和完整 `pending_steer` 字符串，测试观察到 `Direction A` 出现两次。
- RED: Store 缺少 `completeSteerDelivery()`，无法在单一 fenced transaction 内清理 pending steer 并恢复 progress flow。
- GREEN: StorePort 新增结构化 durable steer inbox、`applySteerCommand()`、`pendingSteerCommands()` 和 `completeSteerDelivery()` 领域操作。
- Host 删除进程内 pending steer 列表，只从结构化 inbox 读取 `{ id, instruction }`，同边界 A/B 每条只进入 Agent prompt 一次。
- marker 写入后、ack 前崩溃恢复测试升级为 A/B 两条命令；reclaim Host 从共享 durable inbox 恢复并各投递一次。
- provider 成功后，`completeSteerDelivery(commandIds)` 在同一 fenced transaction 中移除已投递 command ID、重建 `runMeta.pending_steer`，并在 inbox 清空时把 progress flow 从 `steering` 恢复为 `writing`。
- Memory 和 PostgreSQL 均覆盖清理中途 progress 写入失败，验证 inbox、run meta、progress 三者整体回滚。
- Store 合同覆盖分批完成：清理 A 时保留更新后的 B 与 `steering`，清理 B 后统一切换为 `writing`。

## Steer Exactly-Once 测试证据

- 目标测试: 4 files passed，1 PostgreSQL conditional file skipped；53 passed，14 skipped。
- 全量测试: 48 files passed，3 conditional files skipped；371 passed，37 skipped。
- 提交: `fix(worker): deliver steer commands exactly once`，本报告随提交入库。
