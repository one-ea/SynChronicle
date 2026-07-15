# Task 3 实施报告

## 状态

Task 3 已完成：用户名密码认证、Argon2id、opaque session、Cookie 安全属性、退出撤销、修改密码并事务化撤销全部会话、统一 401、Origin 校验、登录速率限制及严格 Fastify 类型扩展均已实现。

## TDD 证据

### RED

- 首次执行 `pnpm vitest run src/web/auth/auth.test.ts`：测试套件因 `./password.js` 等认证模块缺失而失败，符合功能尚未实现的预期。
- 新增 session repository SQL 语义测试后执行同一命令：因 `buildActiveSessionQuery is not a function` 失败，证明测试在查询实现前生效。

### GREEN

- 目标测试：`src/web/auth/auth.test.ts` 6 项通过，覆盖真实 Argon2id、摘要存储、登录、认证装饰、退出、改密撤销、Origin 和限流。
- CLI 回归：`src/cli/parse.test.ts` 11 项通过。
- 完整测试：41 个测试文件通过，291 项通过，1 项按既有条件跳过，共 292 项。

## Argon2 构建与执行证据

- `package.json` 的 `pnpm.onlyBuiltDependencies` 已加入 `argon2`。
- `pnpm rebuild argon2` 成功执行 `cross-env ZERO_AR_DATE=1 node-gyp-build`，安装脚本返回 `Done`。
- 测试真实调用 `argon2.hash` 和 `argon2.verify`，断言哈希以 `$argon2id$` 开头、正确密码验证成功、错误密码验证失败。
- 参数为 `memoryCost: 65536`、`timeCost: 3`、`parallelism: 1`，使用 Argon2id 自带随机盐。

## 实现与自审

- Session token 使用 `randomBytes(32)` 生成 base64url opaque token，数据库仅保存 SHA-256 十六进制摘要。
- Cookie 使用 `HttpOnly`、`SameSite=Strict`、根路径及基于公共 URL 协议启用 `Secure`。
- 活跃 session 查询同时约束 token 摘要、`revoked_at IS NULL`、`expires_at > now` 和 `LIMIT 1`；测试直接检查 Drizzle 生成 SQL 与参数。
- 认证同时检查用户状态，所有凭证、session 和用户状态失败响应均为 `401 { "error": "Unauthorized" }`。
- 修改密码与撤销该用户全部活跃 session 位于同一数据库事务。
- 所有状态变更方法执行精确同源 Origin 校验；登录按客户端 IP 在固定窗口内限流。
- Fastify 的 `request.auth`、`authenticateRequest` 和公共 URL decoration 通过模块扩展保持 strict 类型。
- 未记录密码、原始 session token 或密码哈希。

## 验证

- `pnpm vitest run src/web/auth/auth.test.ts src/cli/parse.test.ts`: 17 项通过。
- `pnpm typecheck`: 通过。
- `pnpm test`: 291 项通过，1 项既有 PostgreSQL 条件测试跳过。
- `pnpm build`: 通过。
- `git diff --check`: 通过。

## 提交

- 提交信息：`feat(web): add password authentication`
- 基线提交：`f4c2c8a`

## 顾虑

- PostgreSQL 集成测试依赖 `TEST_DATABASE_URL`，当前环境未提供，因此既有数据库集成测试保持跳过；session repository 的核心 SQL 查询语义已通过无连接 SQL 构造测试验证。
- 登录限流状态保存在单个 Web 进程内；多实例部署时需要在后续生产加固任务中切换为共享限流存储。

## 独立审查整改项

- Important: `trustProxy: true` 与 `request.ip` 组合使限流键接受任意转发头，需配置可信代理边界。
- Important: 改密撤销与并发登录之间存在新 Session 插入竞态，需增加用户认证版本、锁或等效原子约束。
- Important: 未知用户名需执行 dummy Argon2id 验证，使认证失败路径成本接近。
- Important: 增加撤销、过期、事务回滚和并发改密场景测试。
- Minor: 完整断言 Cookie Secure、Path、Expires、清理属性；限制限流 Map 增长并校验配置为正整数。

## 复审追加整改项

- Important: 增加真实 PostgreSQL 条件测试，在撤销 Session 后触发事务异常，验证密码、`auth_version` 和撤销状态整体回滚。
- Important: 增加真实并发登录与改密、两次并发改密测试，验证认证版本和行锁语义。
- Minor: 将模拟测试描述改为“陈旧认证版本条件失败测试”。

## 最终复审整改项

- Important: Web Server 创建的 PostgreSQL client 必须绑定 Fastify `onClose`，调用 `database.$client.end()`，并增加生命周期测试。

## 独立审查整改结果

### 修复

- `users.auth_version` 与 `sessions.auth_version` 均为从 1 开始的递增认证版本。
- 登录在事务中使用 `SELECT ... FOR UPDATE` 条件确认用户 ID、密码哈希、认证版本和 active 状态，再写入携带同版本的 Session。该用户行锁与改密事务串行化，关闭验证后插入竞态。
- 改密事务使用旧密码哈希和旧认证版本作为条件更新，原子写入新密码、递增版本并撤销全部活跃 Session；并发的陈旧改密请求返回统一 401。
- Session 查询联结用户记录，并同时要求摘要匹配、未撤销、未过期和认证版本一致；请求装饰前再次比较 Session 与用户版本。
- 未知用户使用固定有效 `DUMMY_PASSWORD_HASH` 执行真实 Argon2id verify，统一失败路径计算成本。
- `trustProxy` 改为显式 Web 配置，默认 `false`，环境变量为 `TRUST_PROXY`；认证限流测试使用注入连接地址，不依赖伪造转发头。
- 登录限流参数要求 `max`、`windowMs` 和 `capacity` 为正整数；每次消费清理 TTL 到期项，并限制 Map 最大容量。
- Cookie 测试覆盖 `HttpOnly`、`Secure`、`SameSite=Strict`、`Path=/`、Expires 与 30 天 Session 到期一致性，以及退出时 `Max-Age=0`、Epoch Expires 和完整安全属性。
- 无数据库测试覆盖撤销、过期、认证版本失配、登录并发失配、故障模拟回滚和陈旧认证版本条件失败。

### RED/GREEN

- RED：认证版本查询断言、Schema 字段、dummy verify、原子 Session 创建、限流器、可信代理默认、Cookie 清理和生命周期测试初次运行共 8 项失败。
- RED：原子登录 SQL 语义测试先因构造函数缺失失败；采用事务行锁方案后增加 `FOR UPDATE` 查询断言。
- RED：并发改密测试初次返回 204，证明旧实现会接受陈旧认证版本。
- GREEN：认证、Schema 与 Web 配置目标测试 21 项通过，2 项条件 PostgreSQL 测试因环境未提供 `TEST_DATABASE_URL` 跳过。
- GREEN：完整测试 41 个文件通过，299 项通过，2 项条件测试跳过，共 301 项。
- `pnpm typecheck`、`pnpm build` 和 `git diff --check` 均通过。

### Schema 与迁移

- Drizzle Schema 已为 `users` 和 `sessions` 增加 `auth_version integer default 1 not null`。
- 生成迁移 `drizzle/0002_lean_felicia_hardy.sql` 及 `drizzle/meta/0002_snapshot.json`，journal 已同步。
- Schema 测试断言字段类型和迁移 SQL；条件 PostgreSQL 测试验证默认版本、陈旧凭据拒绝、Session 版本绑定、改密版本递增、Session 撤销及陈旧改密拒绝。
- 最终再次执行 `pnpm drizzle-kit generate`，结果为 `No schema changes, nothing to migrate`。

### 提交

- 提交信息：`fix(auth): harden session lifecycle`

### 剩余顾虑

- 当前环境未提供 `TEST_DATABASE_URL`，PostgreSQL 条件集成测试未实际连接数据库执行；迁移 SQL、Drizzle 查询生成和 repository 行为已由无连接测试覆盖。
- 登录限流仍为单进程内存实现，已具备容量和 TTL 边界；多实例部署需要共享限流后端。

## PostgreSQL Session 竞态复审整改

### RED/GREEN

- RED：先新增 `src/web/auth/session.postgres.test.ts`，`pnpm typecheck` 因 `createAuthRepository` 尚未接受事务阶段钩子而失败。
- 当前环境未设置 `TEST_DATABASE_URL`；新增 3 项真实 PostgreSQL 条件测试完成收集并明确跳过，未执行数据库断言。
- GREEN：增加可选 `AuthRepositoryTransactionHooks`，支持在用户认证行锁定后协调并发，以及在 Session 撤销后注入异常。默认生产调用不启用钩子。
- 目标测试结果：19 项执行通过，5 项 PostgreSQL 条件测试跳过，共收集 24 项。
- 全量测试结果：41 个测试文件执行通过，1 个 PostgreSQL 条件测试文件整体跳过；299 项通过，5 项跳过，共 304 项。
- `pnpm typecheck`、`pnpm build` 和 `git diff --check` 均通过。

### 条件集成覆盖

- 改密事务先更新密码和认证版本、再撤销 Session，随后由钩子抛出异常；测试查询真实数据库并要求密码、`auth_version` 和 `revoked_at` 全部回滚。
- 登录事务持有真实 PostgreSQL 用户行锁时并发启动改密事务；登录提交旧版本 Session 后，改密事务递增版本并撤销 Session，最终活跃 Session 查询必须为空。
- 两个携带同一旧版本 Session 的改密 HTTP 请求并发执行；仅一个返回 204，另一个统一返回 `401 { "error": "Unauthorized" }`，用户版本仅递增一次且全部旧 Session 被撤销。
- 每项测试使用 UUID 隔离用户名与 token 摘要，避免共享数据库中的测试数据互相冲突。

### 提交

- 提交信息：`test(auth): cover database session races`

### 当前顾虑

- 本次环境缺少 `TEST_DATABASE_URL`，上述 3 项真实 PostgreSQL 竞态测试仅完成条件收集和跳过验证。需要在提供隔离 PostgreSQL 的 CI 中实际执行后，才能形成数据库并发与回滚证据。

## Web Database 生命周期最终整改

### RED/GREEN

- RED：先增加 owned 与 borrowed database 生命周期测试；owned 场景中 `app.close()` 未调用 client `end()`，测试失败，且 `pnpm typecheck` 拒绝尚未定义的 database 注入选项。
- GREEN：`buildWebServer` 通过 `databaseUrl` 创建的 database 自动标记为 owned，并注册 Fastify `onClose`，异步等待 `database.$client.end()` 完成。
- GREEN：测试注入 database 时必须显式设置 `databaseOwnership: "owned" | "borrowed"`；owned 注入执行并等待关闭，borrowed 注入保持外部共享 client 开放。
- 目标测试 `src/web/server.test.ts` 与 `src/web/auth/auth.test.ts` 共 17 项通过。
- 全量测试 41 个文件通过、1 个 PostgreSQL 条件文件跳过；301 项通过、5 项跳过，共 306 项。
- `pnpm typecheck`、`pnpm build` 和 `git diff --check` 均通过。

### 提交

- 提交信息：`fix(web): close owned database clients`

### 顾虑

- 当前环境仍缺少 `TEST_DATABASE_URL`，5 项 PostgreSQL 条件测试未执行数据库断言；本次 client 生命周期测试使用注入 database 精确验证所有权和关闭等待语义。
