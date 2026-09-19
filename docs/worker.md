# Cloudflare Workers 部署（P11-C1 切片）

当前状态：Worker 切片覆盖**平台管理面**（认证、渠道、额度、举报、审计、书城发布），AI 生成运行时（Host/Agent）仍在 Node 主线。适合把门户与商用管理面部署到 Cloudflare 边缘，写作引擎继续自托管。

## 架构

```text
Cloudflare Worker (worker/index.ts)
  |-- D1: users / invite_codes / recharge_codes / channels / channel_grants
  |       usage_ledger / audit_logs / reports / kv_files（书稿内容）
  |-- Secrets: MASTER_KEY（AES-256-GCM 信封加密主密钥）
  |-- Vars: MODE=selfhost|commercial
```

复用主线模块（零 Node 依赖）：`src/db/sql-core.ts`（DDL）、`src/db/users.ts`、`src/platform/dao.ts`、`src/domain/publish.ts`、`src/diag/safety.ts`。
Worker 专属：`worker/types.ts`（D1 绑定 + D1KvStore）、`worker/crypto.ts`（Web Crypto 版 AES-GCM/HMAC/PBKDF2）。

## 部署步骤

```bash
# 1. 创建 D1 数据库，把返回的 database_id 填入 wrangler.toml
npx wrangler d1 create synchronicle

# 2. 初始化表结构（首次）
npx wrangler d1 execute synchronicle --remote --file <(echo "SELECT 1")
# 表会在首次请求时由 ensureSchema() 幂等创建，也可用 migrations 目录管理

# 3. 注入主密钥
openssl rand -hex 32 | npx wrangler secret put MASTER_KEY

# 4. 商用模式时设置变量并部署
#    wrangler.toml [vars] MODE = "commercial"
npx wrangler deploy

# 5. 本地开发
pnpm worker:dev
```

## 密码哈希说明

Worker 使用 PBKDF2-SHA256（100k 轮），Node 主线使用 scrypt。两条线密码互不兼容：同一账号体系请固定一条运行时。会话令牌格式（HMAC-SHA256）与渠道密钥信封格式（AES-256-GCM）两侧完全互通。

## 边界与后续

| 能力 | Worker 切片 | Node 主线 |
|------|------------|-----------|
| 认证/注册/邀请码 | 支持 | 支持 |
| 渠道/授权/额度/兑换 | 支持 | 支持 |
| 举报/下架/审计 | 支持 | 支持 |
| 书城/发布（含商用安全闸） | 支持 | 支持 |
| AI 生成/自动驾驶/Steer | 未支持 | 支持 |
| SSE 实时流 | 未支持 | 支持 |
| 文件导入导出 | 未支持 | 支持 |

后续里程碑：C2 Durable Objects 承载 Host 运行时与 SSE；C3 Queues 承载长任务；C4 R2 承载导入导出大文件。
