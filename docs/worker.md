# Cloudflare Workers 部署（P11-C1 切片）

当前状态：Worker 切片覆盖**平台管理面**（认证、渠道、额度、举报、审计、书城发布），AI 生成运行时（Host/Agent）仍在 Node 主线。适合把门户与商用管理面部署到 Cloudflare 边缘，写作引擎继续自托管。

## 架构

```text
Cloudflare Worker (worker/index.ts)
  |-- D1: users / invite_codes / recharge_codes / channels / channel_grants
  |       usage_ledger / audit_logs / reports / kv_files（书稿内容）
  |-- RuntimeHub DO（每 userId:bookId 一个）: SSE 订阅、事件回放、快照
  |-- Secrets: MASTER_KEY（AES-256-GCM 信封加密主密钥）、INTERNAL_TOKEN（事件中继）
  |-- Vars: MODE=selfhost|commercial
```

复用主线模块（零 Node 依赖）：`src/db/sql-core.ts`（DDL）、`src/db/users.ts`、`src/platform/dao.ts`、`src/domain/publish.ts`、`src/diag/safety.ts`。
Worker 专属：`worker/types.ts`（D1 绑定 + D1KvStore）、`worker/crypto.ts`（Web Crypto 版 AES-GCM/HMAC/PBKDF2）、`worker/hub.ts` + `worker/object.ts`（RuntimeHub DO）。

## 部署步骤

```bash
# 1. 创建 D1 数据库，把返回的 database_id 填入 wrangler.toml
npx wrangler d1 create synchronicle

# 2. 初始化表结构（首次）
npx wrangler d1 execute synchronicle --remote --file <(echo "SELECT 1")
# 表会在首次请求时由 ensureSchema() 幂等创建，也可用 migrations 目录管理

# 3. 注入主密钥
openssl rand -hex 32 | npx wrangler secret put MASTER_KEY

# 3b. 注入内部事件中继令牌（Node 主线 → Worker DO 推送 SSE 事件）
openssl rand -hex 16 | npx wrangler secret put INTERNAL_TOKEN

# 4. 商用模式时设置变量并部署
#    wrangler.toml [vars] MODE = "commercial"
npx wrangler deploy

# 5. 本地开发
pnpm worker:dev
```

## 密码哈希说明

Worker 使用 PBKDF2-SHA256（100k 轮），Node 主线使用 scrypt。两条线密码互不兼容：同一账号体系请固定一条运行时。会话令牌格式（HMAC-SHA256）与渠道密钥信封格式（AES-256-GCM）两侧完全互通。

## SSE 边缘中继与内容同步（P11-C2/C3）

生成引擎留在 Node 主线时，Worker 也能提供完整门户体验：

```bash
# Node 侧环境变量（事件中继 + 内容同步共用同一对配置）
EDGE_RELAY_URL=https://<worker域名>
EDGE_RELAY_TOKEN=<与 INTERNAL_TOKEN 相同>
```

配置后：

- **事件中继**：Node 的 `broadcast()` 与快照心跳把 `runtime`/`delta`/`snapshot` 事件推送到 Worker `/api/internal/events`，按 `userId:bookId` 路由进对应 RuntimeHub DO。浏览器订阅 `GET /api/stream?book=<id>` 获得回放 + 实时流。
- **内容同步**：Node 的 FileIO 写入（章节、进度、大纲、书架）经 3 秒去抖后按书籍分批推送到 `/api/internal/sync`，写入 Worker D1 kv（`books/<id>/...` + `platform/bookshelf.json`），自动附带所有权映射。边缘 `/api/books`、`/api/shelf`、`/api/shelf/<id>/chapters/<n>` 随即可读。
- **一次性全量推送**：`EDGE_RELAY_URL=... EDGE_RELAY_TOKEN=... synchronicle edge-sync --book <id>`。

未配置时 Node 行为零变化。

## 边界与后续

| 能力 | Worker 切片 | Node 主线 |
|------|------------|-----------|
| 认证/注册/邀请码 | 支持 | 支持 |
| 渠道/授权/额度/兑换 | 支持 | 支持 |
| 举报/下架/审计 | 支持 | 支持 |
| 书城/发布（含商用安全闸） | 支持 | 支持 |
| 书籍内容/进度 | D1 kv（边缘同步） | 本地/数据库 |
| SSE 实时流 | RuntimeHub DO（中继模式） | 原生 |
| AI 生成/自动驾驶/Steer | 未支持 | 支持 |
| 文件导入导出 | txt 导入/导出（R2 可选存储） | 支持（含 EPUB） |

### 导入导出（P11-C4）

- `POST /api/import`：纯文本按主线同款章节标记切分（`第 N 章` / 中文数字 / `chapter N`），写入 `books/<id>/`（章节、摘要、大纲、进度、所有权），自动登记书架；`bookId` 缺省时按标题新建。
- `POST /api/export`：按 `progress.completed_chapters` 组装 txt；绑定 `EXPORTS`（R2）时落桶 `exports/<userId>/<book>-<ts>.txt` 并返回下载路径，未绑定时内联返回全文。
- `GET /api/export/file/<key>`：仅文件属主可下载。
- 启用 R2：在 `wrangler.toml` 取消 `[[r2_buckets]]` 注释并 `npx wrangler r2 bucket create synchronicle-exports`。

后续里程碑：C5 生成引擎 Worker 化。
