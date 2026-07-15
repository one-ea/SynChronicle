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
