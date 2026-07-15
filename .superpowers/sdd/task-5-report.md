# Task 5 实施报告

## 状态

- 已实现 `StorePort`、`DatabaseStore`、`DatabaseRecordingTransaction`。
- File `Store` 保持原有公共行为，并实现同一 `StorePort`。
- Database Store 通过 `userId/projectId/runId` 三元 scope 隔离全部读写。
- 逻辑工件存入 `artifacts`，最终章节存入 `chapters`；runtime queue、checkpoint、usage 支持读写。

## RED / GREEN

- RED 1：`pnpm vitest run src/store/database/database-store.test.ts src/store/store.test.ts` 因 `DatabaseStore` 模块缺失失败。
- GREEN 1：File Store 与内存 Database Store 共用 contract 通过。
- RED 2：候选提交完成事件缺少 staging 中的真实 completion 数据，原子性断言失败。
- GREEN 2：`commitStaged` 在同一 backend transaction 内提交候选业务工件、checkpoint、usage 和 completion runtime event。
- 回滚证据：内存 backend 注入 constraint failure 后，`commitStaged` reject，候选 premise 保持不可见。

## 接口决策

- `StorePort` 覆盖 Host、Agent、Tool Registry 当前使用的完整 Store 能力，避免数据库类型进入 Agent。
- `StoreScope` 改为基于 `StorePort`，File recording 与 Database recording 共用 Agent 执行路径。
- Database Store 复用现有领域 Store，通过 `DatabaseFileIO` 将逻辑路径映射到数据库，保持 CLI/File Store 兼容。
- `DatabaseRecordingTransaction` 使用现有 recording overlay 在内存缓冲候选写，正式 Store 在 commit 前不可见。

## 验证

- Store/Host/Agent：65 passed，2 skipped。
- 全量测试：317 passed，10 skipped。
- TypeScript：`pnpm typecheck` 通过。
- Build：`pnpm build` 通过。
- Diff：`git diff --check` 通过。
- Migration sync：`pnpm exec drizzle-kit check` 通过。
- PostgreSQL contract：当前未设置 `TEST_DATABASE_URL`，2 项数据库集成测试明确跳过；内存 contract、scope、SQL 构造入口和事务回滚测试有效。

## 提交

- Commit message：`feat(store): add PostgreSQL store adapter`

## 顾虑

- 当前环境缺少 PostgreSQL，真实数据库 migration + contract + rollback 路径留待提供 `TEST_DATABASE_URL` 的 CI 执行。
- Task 2 Schema 使用 `artifacts.type/content_text/content_json` 字段名，适配器按实际 schema 映射；任务简报中的 `kind/text_content/json_content` 属于旧命名。

## 独立审查整改项

- Critical: PostgreSQL artifacts/chapters 必须包含并强制 `user_id/project_id/run_id` scope；当前真实查询忽略 runId。
- Critical: checkpoint、usage、runtime event 必须写入 `checkpoints`、`usage_records`、`run_events` 领域表。
- Critical: PostgreSQL 条件测试必须覆盖跨 run 隔离、领域表映射、候选不可见和真实事务失败回滚。
- Important: 移除通过 `Reflect.set` 替换共享 `StagingSession.io` 的事务实现，使用显式 transaction-bound staging/commit API。
- Important: 解决 DatabaseStore 与 `StorePort.dir`/`exportNovel` 的文件路径耦合。
- Important: chapter 读取当前版本，runtime append 使用数据库序列化写入，避免 read-modify-write 丢事件。
- Important: 扩展共享 contract 覆盖更新、JSON/text、runtime 顺序、checkpoint reload、候选隔离与回滚。

## 独立审查整改结果 2026-07-15

### 修复

- `artifacts`、`chapters` 新增非空 `run_id`，通过 `user_id/project_id/run_id -> runs` 复合外键强制归属；唯一索引包含完整 scope。
- 新迁移先为历史 project scope 创建或复用 run，回填 `run_id`，再启用非空、复合外键和完整 scope 唯一索引。
- runtime queue 映射 `run_events`，checkpoint 映射 `checkpoints`，usage aggregate snapshot 映射 `usage_records.state`。
- runtime append 在数据库事务中获取 run 级 advisory lock，并从领域表分配下一 sequence，消除文件式 read-modify-write。
- chapter 每次写入新版本，读取按 version 降序返回最新内容。
- `StagingSession.bind(io)` 提供显式 transaction-bound session；候选提交不再反射替换共享私有 IO。
- Store 导出路径通过 `resolveExportPath` 抽象；DatabaseStore 缺省导出给出明确错误，显式 `options.path` 可正常导出。
- shared contract 新增 text/JSON 更新、chapter 最新版本、runtime 并发顺序、checkpoint reload/reset、候选不可见和校验回滚覆盖。
- `TEST_DATABASE_URL` 条件测试新增跨 run 隔离、领域表落库、并发 event sequence、chapter 最新版本、候选不可见及真实 constraint rollback。

### RED / GREEN

- RED：Schema 元数据测试缺少 artifacts/chapters run 复合外键；内存 backend 无领域表；Database Host export 尝试写入 `database://`；领域表 reset 保留旧事件。
- GREEN：Store/Host/Agent/Schema 目标测试 81 passed，10 skipped；`pnpm typecheck`、`drizzle-kit check`、`git diff --check` 通过。
- 全量验证：327 passed，16 skipped；`pnpm build` 通过。
- PostgreSQL 条件测试在当前无 `TEST_DATABASE_URL` 环境明确跳过 10 项；测试代码会在数据库环境执行 migration 后验证真实约束和回滚。

### 提交

- Commit message：`fix(store): enforce database run isolation`

### 剩余顾虑

- 当前环境未提供 PostgreSQL，advisory lock、复合外键和真实 constraint rollback 依赖带 `TEST_DATABASE_URL` 的 CI 完成运行时验证。
- usage 当前以 aggregate snapshot 记录写入 `usage_records.state`；后续逐调用计量可在 Task 13 或 usage pipeline 扩展时并存。

---

## 前序候选暂存实施记录

### 状态

已完成候选工件暂存与最终提交能力。

### 实现

- 新增 `StagedArtifactStore` 和 session 级 `StagingSession`。
- 工件按 `meta/reflection/<session-id>/round-<n>/` 隔离暂存。
- manifest 持久化目标路径、内容文件、round 和 `staged`/`committed` 状态。
- `commit(candidateIds)` 仅写入选中工件，并在每项成功后原子更新 manifest。
- 已提交工件在恢复和重复提交时自动跳过，支持部分失败后的幂等恢复。
- `saveState`/`loadState` 支持 session 执行状态持久化。
- Store 通过 `store.staging` 集成暂存能力。
- session ID、目标路径及 manifest 内容路径均进行越界校验，内容文件严格绑定当前 session。
- 实现未包含任何正式数据删除操作。

### TDD 记录

- 首次执行 `pnpm vitest run src/store/staging.test.ts`：按预期失败，原因是 `./staging.js` 尚未实现。
- 新增跨 session manifest 引用测试：按预期失败，证明原校验未绑定当前 session。
- 收紧 manifest 校验后测试转绿。

### 验证

- `pnpm vitest run src/store/staging.test.ts src/store/store.test.ts`：2 个测试文件通过，10 个测试通过。
- `pnpm typecheck`：通过。

### 关注点

- manifest 与 state 使用原子文件写入；进程级并发通过 session 内 promise 链串行化。
- 多进程同时操作同一 session 未引入文件锁，调用方应保证单 session 单写者。
- 暂存内容保留用于恢复和审计，当前任务不执行清理。

### 修复记录 2026-07-13

- 提交前完整解析候选 ID；任何未知 ID 会使整批提交拒绝，正式文件保持不变。
- 同一提交选择集中出现重复 `target` 时整批拒绝。
- manifest 状态扩展为 `staged`、`committing`、`committed`，并为每个工件保存 SHA-256 内容摘要。
- 正式文件写入前先持久化 `committing`；恢复时核验暂存内容摘要和正式文件摘要，随后补写正式文件或直接推进 `committed`。
- 增加正式文件写入成功、`committed` manifest 写入失败后的重启恢复测试，覆盖崩溃窗口。
- `StagedArtifactStore` 缓存同 session 实例；所有 Store 实例通过根目录和 session ID 共享进程级锁，每次锁内重新读取 manifest，避免并发快照覆盖。
- manifest 使用完整 Zod strict schema 校验字段、状态、摘要、非负整数 round 和 ID 唯一性；动态校验 `contentFile` 必须精确匹配当前 session、round 与 ID。
- 所有 staging 和正式目标读写前逐段执行 `lstat`，拒绝任意现存符号链接，并验证规范路径位于 realpath 后的 Store 根目录内。
- 保持正式数据只写不删，暂存数据持续保留。

TDD 证据：新增测试首次运行 10 项中 4 项失败；修复后 staging 与 Store 回归 15 项通过；项目全量 208 项通过；`pnpm typecheck` 通过。

剩余边界：共享锁覆盖单 Node.js 进程中的多个 Store 实例；跨进程并发仍需上层保证单 session 单写者或后续引入平台文件锁。路径检查与原子写之间存在操作系统级 TOCTOU 边界。

### 第二轮修复记录 2026-07-13

- `commit` 先完整校验候选 ID 和重复 target，再仅恢复请求选择集中的 `committing` 工件；非法请求不会触发任何正式 Store 写入。
- target 策略禁止 `meta/reflection` 及其所有子路径，保护 manifest、state 和暂存内容控制命名空间。
- 共享锁键改用 Store 根目录 `realpath` 与 session ID，确保同一根目录的符号链接别名共用锁。
- 增加 reflection 控制目录、session 目录和 round 内容目录符号链接测试，三层内部路径均在读写前拒绝。
- 保持正式数据无删除操作。

TDD 与验证：新增测试首次运行 16 项中 3 项失败；staging 与 Store 回归 22 项通过；项目全量 215 项通过；`pnpm typecheck` 通过。

边界：session 打开与 `status()` 仍作为显式恢复入口推进全部 `committing` 工件；`commit()` 的恢复范围严格限定为已通过请求校验的候选集。realpath 锁统一覆盖单进程路径别名；跨进程写入约束保持不变。
