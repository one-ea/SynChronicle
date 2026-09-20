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
| 对话式生成 | 支持（渠道直连流式 + 计费） | 支持 |
| 两段式流水线（策划→成章） | 支持（agent=compose 计费） | 支持（多智能体完整版） |
| 一致性记忆（角色/伏笔/前文） | 支持（BM25 + schema 兼容） | 支持 |
| 章末摘要/弧级评审 | 支持（agent=review 计费） | 支持 |
| 自动驾驶（评审×重写循环） | 支持（agent=autopilot 计费） | 支持 |
| 自动驾驶/Steer/多智能体 | 未支持 | 支持 |
| 文件导入导出 | txt 导入/导出（R2 可选存储） | 支持（含 EPUB） |

### 导入导出（P11-C4）

- `POST /api/import`：纯文本按主线同款章节标记切分（`第 N 章` / 中文数字 / `chapter N`），写入 `books/<id>/`（章节、摘要、大纲、进度、所有权），自动登记书架；`bookId` 缺省时按标题新建。
- `POST /api/export`：按 `progress.completed_chapters` 组装 txt；绑定 `EXPORTS`（R2）时落桶 `exports/<userId>/<book>-<ts>.txt` 并返回下载路径，未绑定时内联返回全文。
- `GET /api/export/file/<key>`：仅文件属主可下载。
- 启用 R2：在 `wrangler.toml` 取消 `[[r2_buckets]]` 注释并 `npx wrangler r2 bucket create synchronicle-exports`。

### 对话式生成（P11-C5）

- `GET /api/chat?book=<id>`：读取 `books/<id>/meta/chat.jsonl` 会话历史（最近 20 轮）。
- `POST /api/chat {bookId, message, model?}`：选择可用渠道（OpenAI 兼容），解密密钥后流式调用上游 `chat/completions`：
  - 响应为 SSE 流（`delta` 增量 → `done` 含 usage/cost），fetch 客户端直接读 `response.body`
  - 增量同步推送 RuntimeHub DO，订阅 `GET /api/stream?book=<id>` 的客户端实时可见
  - 会话轮次持久化到 kv；商用模式按上游 usage 结算成本写入 `usage_ledger` 并扣减额度（主线同款价格表）
  - anthropic/google provider 暂不支持（非 OpenAI 兼容协议）

### 两段式创作流水线（P11-C6）

- `POST /api/compose {bookId, premise, chapters?, wordsPerChapter?, model?}`：
  - 阶段一策划：输出 `第 N 章｜标题` 计划（解析容错，最多取请求章数）
  - 阶段二逐章成文：每章按大纲生成约 `wordsPerChapter` 字正文，流式增量推送 SSE 与 RuntimeHub
  - 产物自动落库：章节 `books/<id>/chapters/NN.md`、摘要、大纲、进度合并（保留既有完成章节与累计字数）
  - 商用模式合并 usage 一次结算（agent=compose），枢纽发布策划/章节/完成事件
- 响应为 SSE：`plan` → `delta`（带 chapter 标记）→ `done`（章节数、总 usage、cost）。

### 一致性记忆（P11-C7）

- `GET/POST /api/entities?book=<id>`：角色卡 CRUD（`meta/entities.json`，主线 Entity schema 兼容），`mood/goals/chapter` 追加角色状态时间线。
- `GET/POST /api/foreshadows?book=<id>`：伏笔台账 CRUD（`meta/foreshadows.json`，主线 Foreshadow schema 兼容）。
- compose 逐章写作自动注入记忆块（写手 system prompt）：
  - 【前文回顾】已完成章节摘要（BM25 按本章大纲相关性排序，取前 5）
  - 【上一章结尾】上一章末尾 400 字（衔接用）
  - 【登场角色】相关角色卡 + 最新情绪/目标（BM25 排序取前 6）
  - 【未回收伏笔】非 resolved 伏笔按紧迫度排序（取前 8）

### Editor 评审（P11-C8）

- compose 每章写完自动调用模型生成 120 字摘要，替换大纲占位写入 `summaries/NN.json`（摘要 usage 计入当次结算）。
- `POST /api/review {bookId, from?, to?, premise?, model?}`：弧级评审——汇编区间内章节摘要（缺失时回退正文前 160 字），要求模型输出 JSON 报告（score/verdict/issues/suggestions，容错解析 markdown 围栏，解析失败降级为纯文本 verdict），报告持久化 `meta/reviews.json`，商用按 `agent=review` 结算。
- `GET /api/reviews?book=<id>`：最近 20 份报告（新到旧）。
- 评审开始/完成事件推送 RuntimeHub。

### 边缘自动驾驶（P11-C9）

- `POST /api/autopilot {bookId, premise, chapters?, wordsPerChapter?, scoreThreshold?=85, maxRewrites?=1, model?}`：
  - 第一弧：策划 → 带记忆写作 → 章末摘要 → 落库（复用 compose 的 runArc）
  - 评审循环：弧级评审得分 < 阈值时，取 issues 中的高/中严重章节（最多 3 章）带原文与意见重写，再评审；最多 `maxRewrites` 轮
  - SSE 事件流：`plan` → `delta` → `review`（每轮得分）→ `rewrite`（重写章节）→ `done`（finalScore/passed）
  - 全程 usage 合并为一条 `agent=autopilot` 账本结算；枢纽发布每轮事件
- 组合使用：autopilot 完成后 `POST /api/publish`（商用安全闸）→ 书城可见。

后续里程碑：C10 SPA 控制台边缘化（webui 接入 stream/chat/compose/autopilot）。
