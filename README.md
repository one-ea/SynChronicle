# SynChronicle

多智能体 AI 长篇创作引擎。SynChronicle 由 Coordinator 驱动 Architect、Writer 与 Editor 协作完成规划、写作、评审和持续演进，把一句创作需求推进为可恢复、可干预的完整长篇作品。

[![Node.js](https://img.shields.io/badge/Node.js-24%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![npm](https://img.shields.io/npm/v/synchronicle)](https://www.npmjs.com/package/synchronicle)
[![License](https://img.shields.io/github/license/one-ea/SynChronicle)](LICENSE)

SynChronicle 面向需要持续推进长篇故事的创作者与开发者。它把规划、章节写作、质量评审、状态维护和断点恢复组织为一个可观察的本地工作流。

## 核心能力

- Coordinator 在单次长循环中统筹完整创作流程。
- Architect 维护前提、大纲、卷弧规划、角色和世界规则。
- Writer 结合近期正文、摘要、伏笔和角色状态逐章创作。
- Editor 从结构、一致性、节奏和审美维度审阅正文。
- 每个关键工具步骤写入 checkpoint，进程中断后可恢复。
- 卷、弧、章三级摘要支持数百章作品的上下文管理。
- TUI 展示运行进度，并接受创作过程中的用户干预。
- OpenRouter、Anthropic、Gemini、OpenAI 及兼容接口可按配置切换。

## 多智能体工作流

```text
创作需求
   |
   v
Coordinator
   |-- Architect: 前提、大纲、角色、世界观、滚动规划
   |-- Writer: 章节计划、草稿、一致性检查、终稿提交
   `-- Editor: 弧级与卷级评审、摘要、修改建议
   |
   v
Store: 正文、元数据、摘要、状态与 checkpoints
```

Host 负责启动、恢复、事件观察和干预注入。Coordinator 负责决策，三个子智能体通过持久化工件协作。

Writer 的标准章节循环为：加载上下文、回读前文、规划章节、写入草稿、一致性检查、提交终稿。弧或卷到达边界后，Editor 评审，Architect 再展开下一阶段。

## 快速安装

需要 Node.js 24 LTS 或更高版本。通过 npm 全局安装：

```bash
npm install -g synchronicle
```

安装指定版本：

```bash
npm install -g synchronicle@2.0.0
```

仓库中的安装脚本也会调用 npm，并支持通过参数或 `SYNCHRONICLE_VERSION` 指定版本：

```bash
curl -fsSL https://raw.githubusercontent.com/one-ea/SynChronicle/main/scripts/install.sh | sh
```

检查安装结果：

```bash
synchronicle --version
```

## 最小配置

首次运行会引导创建 `~/.synchronicle/config.json`。也可以手动创建以下 JSONC 配置：

```jsonc
{
  "provider": "openrouter",
  "model": "google/gemini-2.5-flash",
  "providers": {
    "openrouter": {
      "type": "openai",
      "api_key": "your-api-key",
      "base_url": "https://openrouter.ai/api/v1"
    }
  }
}
```

配置按以下优先级加载：

1. `~/.synchronicle/config.json`：用户全局配置。
2. `./.synchronicle/config.json`：当前作品的项目级覆盖。
3. `--config path/to/config.json`：命令行指定文件。

项目级配置会与全局配置合并，适合为某本作品指定模型、代理地址或角色设置。

### Provider 出站域名

Web 与 Worker 对用户凭证的自定义 `base_url` 使用 Provider 维度的 HTTPS hostname allowlist。内置 Provider 仅允许各自官方 API 域名。管理员可通过项目专用环境变量追加精确域名或受控子域后缀：

```bash
PROJECT_PROVIDER_ALLOWED_HOSTS='{"openai":["gateway.example.com",".ai.example.net"]}'
```

配置值为 JSON 对象，键是小写 Provider 名，值是 hostname 数组。精确规则只匹配该 hostname；点前缀规则匹配其下级子域，并且至少包含三段域名。URL、IP、`localhost`、通配符及宽泛公共后缀会在启动时被拒绝。所有获准 hostname 仍需通过 DNS 解析、全局单播地址检查和连接固定。

### 反思执行

Architect、Writer 和 Editor 默认采用反思执行：每轮由原 Agent 生成候选，再交给独立 Reviewer 会话评分。Reviewer 不注册创作业务工具，可使用 `reflection.reviewer_model` 指定独立模型；省略时沿用默认模型。

默认最多执行 3 轮，通过阈值为 85 分。候选达到阈值后立即提交；达到轮数上限仍未通过，或预算在后续轮次前耗尽时，系统返回已评分候选中的最高分结果，同分选择较新的轮次，并附带未达阈值或预算耗尽的质量风险及未解决问题。

```jsonc
{
  "reflection": {
    "enabled": true,
    "max_rounds": 3,
    "pass_threshold": 85,
    "review_retry_limit": 2,
    "reviewer_model": "anthropic/claude-sonnet-4"
  }
}
```

每轮包含一次原 Agent 执行和一次 Reviewer 评审，修订轮会重复这组调用；Reviewer 结构化输出重试也可能产生额外调用。默认配置最多产生三组执行与评审用量，因此会增加 Token 消耗、运行时间和模型费用。可通过降低 `max_rounds`、选择成本更低的 Reviewer 模型或设置预算控制成本。

运行时用量快照和持久化的 `meta/usage.json` 会在 `per_agent.reviewer.latency_ms` 中累计 Reviewer 模型调用延迟，单位为毫秒；旧版用量文件缺少该可选字段时仍可直接加载。

## 启动与常用命令

### 容器化 Web 平台

生产部署由 Web、Worker 和 PostgreSQL 组成。Web 的单个端口同时提供前端静态资源、API 与 WebSocket，Worker 和 PostgreSQL 不发布端口。复制 `.env.web.example` 为 `.env.web` 并替换全部占位值后启动：

```bash
ENV_FILE=.env.web docker compose config
ENV_FILE=.env.web docker compose up -d --build
```

存活检查为 `/api/health/live`，数据库与镜像内全部 Drizzle migration hash/created_at 一致性检查为 `/api/health/ready`。Worker 健康检查绑定实际 Node PID、启动 nonce/timestamp 和 `/proc` 命令行。迁移服务成功退出后 Web 和 Worker 才会启动。终止时 Web 先进入 not-ready 排空状态、关闭 WebSocket，再停止监听。恢复流程使用新数据库验证并保留时间戳旧库。备份、恢复、可恢复凭证重加密、Worker 扩容、额度对账与故障排查见 `docs/operations/container-deployment.md`。

在计划存放作品的目录中启动交互式 TUI：

```bash
mkdir my-novel
cd my-novel
synchronicle
```

携带一句需求启动无界面创作：

```bash
synchronicle --headless --prompt "写一本发生在海上空间站的悬疑长篇"
```

从文件读取需求：

```bash
synchronicle --headless --prompt-file prompt.txt
```

指定配置文件：

```bash
synchronicle --config ./config.json
```

查看版本并更新：

```bash
synchronicle --version
synchronicle update
```

每本小说绑定启动目录。回到同一目录再次运行时，系统会读取最近 checkpoint 并继续推进。

## 作品输出

创作数据默认写入当前目录的 `output/novel/`：

```text
output/novel/
|-- premise.md             故事前提
|-- outline.json           扁平章节大纲
|-- layered_outline.json   分层卷弧大纲
|-- characters.json        角色档案与状态
|-- world_rules.json       世界规则
|-- chapters/              章节正文
|-- summaries/             章、弧、卷摘要
|-- drafts/                章节计划与写作草稿
|-- reviews/               Editor 评审结果
`-- meta/                  运行状态、checkpoints 与运行工件
```

产物采用可直接阅读和检查的本地文件保存。备份整个作品目录即可保留正文、规划和恢复状态。

移除 `output/` 会清除当前目录下的创作进度，请在操作前完成备份。

## 架构概览

SynChronicle 遵循“LLM 驱动，Host 服务”的运行模型：

- `src/cli` 提供 CLI、TUI 和 headless 入口分发。
- `src/runtime` 管理启动、恢复、事件与运行生命周期。
- `src/agents` 构建 Coordinator、Architect、Writer 和 Editor。
- `src/tools` 提供原子化创作工具及 checkpoint 边界。
- Store 持久化正文、摘要、状态、评审和上下文工件。

深入设计文档：

- [运行时架构](docs/architecture.md)
- [上下文管理](docs/context-management.md)
- [可观测性](docs/observability.md)
- [评测体系](docs/evaluation-system.md)
- [用户规则运行时](docs/user-rules-runtime.md)
- [提示词缓存设计](docs/prompt-cache-design.md)

## 本地开发

克隆仓库并运行：

```bash
git clone https://github.com/one-ea/SynChronicle.git
cd SynChronicle
corepack enable
pnpm install --frozen-lockfile
pnpm build
node dist/cli/index.js
```

执行项目验证：

```bash
pnpm typecheck
pnpm test
pnpm build
npm pack --dry-run
sh -n scripts/install.sh
```

版本标签触发 GitHub Actions，在 Node.js 24 环境中完成验证并发布 npm 包。包内容包含运行产物、Markdown 资产、`README.md`、`LICENSE` 和 `NOTICE`。

## 数据与密钥安全

- API Key 只应写入本地配置文件，示例值始终使用占位符。
- `~/.synchronicle` 和项目级 `./.synchronicle` 应限制为当前用户访问。
- 请勿提交包含真实凭据的配置文件、日志或诊断输出。
- 使用第三方模型服务时，请确认其数据处理与保留策略符合你的要求。
- 作品正文和运行状态保存在本地 `output/`，备份与清理由用户控制。
- 共享问题报告前，请检查配置、提示词和正文中是否含敏感信息。

## 许可证

SynChronicle 使用 Apache License 2.0 发布。

Copyright 2026 one-ea

完整条款见 [LICENSE](LICENSE)，版权与归属声明见 [NOTICE](NOTICE)。
