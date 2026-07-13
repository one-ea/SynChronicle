# Task 5 实施报告

## 状态

已完成候选工件暂存与最终提交能力。

## 实现

- 新增 `StagedArtifactStore` 和 session 级 `StagingSession`。
- 工件按 `meta/reflection/<session-id>/round-<n>/` 隔离暂存。
- manifest 持久化目标路径、内容文件、round 和 `staged`/`committed` 状态。
- `commit(candidateIds)` 仅写入选中工件，并在每项成功后原子更新 manifest。
- 已提交工件在恢复和重复提交时自动跳过，支持部分失败后的幂等恢复。
- `saveState`/`loadState` 支持 session 执行状态持久化。
- Store 通过 `store.staging` 集成暂存能力。
- session ID、目标路径及 manifest 内容路径均进行越界校验，内容文件严格绑定当前 session。
- 实现未包含任何正式数据删除操作。

## TDD 记录

- 首次执行 `pnpm vitest run src/store/staging.test.ts`：按预期失败，原因是 `./staging.js` 尚未实现。
- 新增跨 session manifest 引用测试：按预期失败，证明原校验未绑定当前 session。
- 收紧 manifest 校验后测试转绿。

## 验证

- `pnpm vitest run src/store/staging.test.ts src/store/store.test.ts`：2 个测试文件通过，10 个测试通过。
- `pnpm typecheck`：通过。

## 关注点

- manifest 与 state 使用原子文件写入；进程级并发通过 session 内 promise 链串行化。
- 多进程同时操作同一 session 未引入文件锁，调用方应保证单 session 单写者。
- 暂存内容保留用于恢复和审计，当前任务不执行清理。

## 修复记录 2026-07-13

### 高/中严重问题修复

- 提交前完整解析候选 ID；任何未知 ID 会使整批提交拒绝，正式文件保持不变。
- 同一提交选择集中出现重复 `target` 时整批拒绝。
- manifest 状态扩展为 `staged`、`committing`、`committed`，并为每个工件保存 SHA-256 内容摘要。
- 正式文件写入前先持久化 `committing`；恢复时核验暂存内容摘要和正式文件摘要，随后补写正式文件或直接推进 `committed`。
- 增加正式文件写入成功、`committed` manifest 写入失败后的重启恢复测试，覆盖崩溃窗口。
- `StagedArtifactStore` 缓存同 session 实例；所有 Store 实例通过根目录和 session ID 共享进程级锁，每次锁内重新读取 manifest，避免并发快照覆盖。
- manifest 使用完整 Zod strict schema 校验字段、状态、摘要、非负整数 round 和 ID 唯一性；动态校验 `contentFile` 必须精确匹配当前 session、round 与 ID。
- 所有 staging 和正式目标读写前逐段执行 `lstat`，拒绝任意现存符号链接，并验证规范路径位于 realpath 后的 Store 根目录内。
- 保持正式数据只写不删，暂存数据持续保留。

### TDD 证据

- 新增测试首次运行：10 项中 4 项失败，稳定复现重复 target/未知 ID、manifest 崩溃窗口、跨实例丢更新和符号链接逃逸。
- 修复后 staging 与 Store 回归：2 个测试文件、15 个测试通过。
- 项目全量回归：35 个测试文件、208 个测试通过。
- `pnpm typecheck`：通过。

### 剩余边界

- 共享锁覆盖单 Node.js 进程中的多个 Store 实例；跨进程并发仍需上层保证单 session 单写者或后续引入平台文件锁。
- 路径检查与原子写之间存在操作系统级 TOCTOU 边界；在受信任 Store 根目录和单写者模型下，逐段符号链接拒绝可阻断静态链接逃逸。
