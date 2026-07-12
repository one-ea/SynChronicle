# Requirements Document

## Introduction

SynChronicle 当前的完整实现使用 Go 1.25 和 Bubble Tea TUI 框架，依赖 agentcore 和 litellm 进行 LLM 调用，通过 GoReleaser 发布二进制归档和 Docker 镜像。本次需求把运行时从 Go 一次性迁移到 Node.js 24 LTS，保留全部功能等价，移除 Docker 运行和部署，使用 npm 全局包发布，Vercel AI SDK 统一多 Provider 调用，Ink + React 重建终端 TUI。

## Glossary

- **SynChronicle**: 多智能体 AI 长篇创作引擎。
- **Coordinator**: 统筹 Architect、Writer 和 Editor 的编排 Agent。
- **Architect**: 维护前提、大纲、卷弧规划、角色和世界规则的 Agent。
- **Writer**: 逐章创作草稿、一致性检查并提交终稿的 Agent。
- **Editor**: 从结构、一致性、节奏和审美维度审阅正文并生成摘要的 Agent。
- **Host**: 管理启动、恢复、事件和干预注入的运行时外壳。
- **Flow Router**: 根据事实决定下一步调用哪个子代理的垂类路由器。
- **Checkpoint**: 工具成功完成后追加到 JSONL 的恢复点，是断点恢复的唯一事实来源。
- **Store**: 持久化正文、元数据、摘要、状态和 checkpoint 的文件存储。
- **Provider Adapter**: 将 Vercel AI SDK 的多 Provider 能力映射到现有配置格式的适配层。
- **Bubble Tea**: Go 终端 TUI 框架，迁移后替换为 Ink。
- **Ink**: 基于 React 的终端 UI 框架，替代 Bubble Tea。
- **Vercel AI SDK**: 统一接入 OpenAI、Anthropic、Gemini 和 OpenAI-compatible 的 Node.js SDK。
- **GoReleaser**: Go 二进制发布工具，迁移后移除。
- **pnpm**: Node.js 包管理器，替代 Go module 管理。

## Requirements

### Requirement 1: Node.js 24 LTS 运行时

**User Story:** AS 用户，I want 在 Node.js 24 LTS 环境中安装和运行 SynChronicle，SO THAT 我不需要安装 Go 工具链。

#### Acceptance Criteria

1. The system SHALL 声明 `engines.node >= 24` 作为运行时最低版本要求。
2. The system SHALL 使用 pnpm 10 作为开发依赖管理工具。
3. WHEN 用户执行 `npm install -g synchronicle`，the system SHALL 全局安装可执行的 `synchronicle` 命令。
4. WHEN 用户执行 `synchronicle --version`，the system SHALL 输出版本号。
5. The system SHALL 在 Node.js 24 LTS 环境中通过全部类型检查和测试。

### Requirement 2: CLI 参数兼容

**User Story:** AS 用户，I want Node.js 版本的 CLI 参数与现有版本完全一致，SO THAT 我的现有脚本和工作流无需修改。

#### Acceptance Criteria

1. The system SHALL 支持 `--config <path>` 指定配置文件路径。
2. The system SHALL 支持 `--headless` 启动无界面模式。
3. The system SHALL 支持 `--prompt <text>` 在 headless 模式下传入创作需求。
4. The system SHALL 支持 `--prompt-file <path>` 从文件读取创作需求。
5. The system SHALL 支持 `version` 子命令和 `--version` / `-v` 标志输出版本信息。
6. The system SHALL 支持 `update` 子命令执行自更新。
7. WHEN 用户同时指定 `--prompt` 和 `--prompt-file`，the system SHALL 报错并退出。
8. WHEN 用户在非 headless 模式下使用 `--prompt` 或 `--prompt-file`，the system SHALL 报错并退出。
9. WHEN 用户将 `version` 或 `update` 与其他启动参数混用，the system SHALL 报错并退出。

### Requirement 3: 配置加载与合并

**User Story:** AS 用户，I want Node.js 版本继续读取我现有的 `.synchronicle` 配置，SO THAT 我不需要重新配置 Provider 和模型。

#### Acceptance Criteria

1. The system SHALL 按优先级加载配置：`--config` > `./.synchronicle/config.json` > `~/.synchronicle/config.json`。
2. The system SHALL 将项目级配置与全局配置合并，项目级覆盖同名键。
3. The system SHALL 支持现有 JSONC 格式（含注释的 JSON）。
4. WHEN 首次运行且无配置文件存在，the system SHALL 在 TUI 模式下引导创建配置。
5. WHEN 首次运行且无配置文件存在，the system SHALL 在 headless 模式下报错并退出。
6. The system SHALL 校验 provider 和 model 字段非空。
7. The system SHALL 校验默认 provider 在 `providers` map 中存在凭证。
8. The system SHALL 允许 `ollama` 和 `bedrock` provider 省略 `api_key`。
9. The system SHALL 支持角色级模型覆盖（coordinator / architect / writer / editor）。
10. The system SHALL 支持 `reasoning_effort` 配置（off / low / medium / high / xhigh / max）。
11. The system SHALL 支持 `context_window` 显式配置。
12. The system SHALL 支持 `budget` 预算配置（book_usd / warn_ratio / hard_stop）。
13. The system SHALL 支持 `notify` 告警配置（enabled / command / events）。
14. The system SHALL 支持 `style` 创作风格配置。
15. The system SHALL 支持 `providers.*.extra_body` 透传请求体参数。
16. The system SHALL 支持 `providers.*.extra` 透传 HTTP 客户端层配置。
17. The system SHALL 支持 `providers.*.api` 字段指定 OpenAI 协议端点类型。
18. The system SHALL 支持 `roles.*.fallbacks` 显式备用 Provider/Model 列表。

### Requirement 4: LLM Provider Adapter

**User Story:** AS 用户，I want 通过 Vercel AI SDK 统一调用 OpenAI、Anthropic、Gemini、OpenRouter 和自定义代理，SO THAT 我不需要为每个 Provider 维护独立的 HTTP 逻辑。

#### Acceptance Criteria

1. The system SHALL 使用 Vercel AI SDK 的 `generateText` 和 `streamText` 接口进行模型调用。
2. The system SHALL 通过 Vercel AI SDK Provider 插件接入 OpenAI、Anthropic 和 Google Gemini。
3. The system SHALL 通过 OpenAI-compatible 模式接入 OpenRouter、DeepSeek、Qwen、GLM、Grok 和自定义代理。
4. WHEN provider 配置指定 `type: "openai"`，the system SHALL 使用 OpenAI-compatible 适配。
5. WHEN provider 配置指定 `type: "anthropic"`，the system SHALL 使用 Anthropic 适配。
6. WHEN provider 配置未指定 `type` 且 provider 名在已知列表中，the system SHALL 按已知协议处理。
7. The system SHALL 支持流式文本输出。
8. The system SHALL 支持工具调用（tool calling）。
9. The system SHALL 支持 `extra_body` 透传到请求体。
10. The system SHALL 支持 `extra` 透传到 HTTP 客户端层。
11. The system SHALL 支持 Provider Failover，按角色级 `fallbacks` 列表自动切换。
12. The system SHALL 支持 `reasoning_effort` 按角色传递到模型。

### Requirement 5: 多智能体协作

**User Story:** AS 用户，I want Coordinator、Architect、Writer 和 Editor 在 Node.js 版本中保持相同协作流程，SO THAT 创作质量与 Go 版本一致。

#### Acceptance Criteria

1. The system SHALL 保留 Coordinator 作为唯一编排入口。
2. The system SHALL 保留 Architect（architect_long / architect_short）维护前提、大纲、卷弧、角色和世界规则。
3. The system SHALL 保留 Writer 执行章节计划、草稿、一致性检查和终稿提交。
4. The system SHALL 保留 Editor 执行弧级和卷级评审、摘要和修改建议。
5. The system SHALL 通过 Flow Router 按事实决定下一步调用哪个子代理。
6. The system SHALL 在每个工具成功完成后写入 Checkpoint。
7. The system SHALL 支持 Coordinator 的 ContextEngine 上下文窗口管理和压缩。
8. The system SHALL 支持子代理的独立上下文管理策略。
9. The system SHALL 支持 `novel_context` 工具按角色返回不同上下文。

### Requirement 6: 断点恢复

**User Story:** AS 用户，I want 进程中断后回到同一目录再次运行能继续创作，SO THAT 我不会丢失进度。

#### Acceptance Criteria

1. The system SHALL 在工具成功落盘后追加 Checkpoint 到 JSONL。
2. The system SHALL 在恢复时从最近完整 Checkpoint 继续。
3. The system SHALL 在恢复时生成包含已完成章节、总章数和总字数的恢复标签。
4. The system SHALL 在恢复时读取 `PendingSteer` 并传递给 Coordinator。
5. WHEN Progress.Phase 为 `complete`，the system SHALL 返回空标签表示新建。
6. The system SHALL 支持 `PausePointSentinel` 停靠点暂停。
7. The system SHALL 支持 `BudgetSentinel` 预算止损。

### Requirement 7: 作品存储兼容

**User Story:** AS 用户，I want Node.js 版本读写现有的作品数据目录，SO THAT 我在 Go 版本创建的小说可以无缝继续。

#### Acceptance Criteria

1. The system SHALL 读写 `output/novel/` 目录结构。
2. The system SHALL 读写 `premise.md`、`outline.json`、`layered_outline.json`、`characters.json`、`world_rules.json`。
3. The system SHALL 读写 `chapters/`、`summaries/`、`drafts/`、`reviews/`、`meta/` 子目录。
4. The system SHALL 读写 `meta/progress.json` 进度文件。
5. The system SHALL 读写 `meta/checkpoints.jsonl` 检查点文件。
6. The system SHALL 读写 `meta/run_meta.json` 运行元数据。
7. The system SHALL 读写 `meta/usage.json` 用量统计。
8. The system SHALL 读写 `meta/sessions/` 会话日志。
9. The system SHALL 使用 Zod 校验读入的持久化数据格式。
10. The system SHALL 保持写回格式与 Go 版本兼容。
11. The system SHALL 在启动时执行 `CheckConsistency` 浅层校验。
12. The system SHALL 在启动时执行 `FoundationMissing` 基础设定缺项检查。

### Requirement 8: TUI 交互

**User Story:** AS 用户，I want 在终端中使用交互式 TUI 观察创作进度并干预，SO THAT 我能掌控创作过程。

#### Acceptance Criteria

1. The system SHALL 使用 Ink + React 构建终端 TUI。
2. The system SHALL 显示当前阶段与 Agent 状态。
3. The system SHALL 显示流式模型输出。
4. The system SHALL 显示工具调用进度。
5. The system SHALL 显示 token 与耗时统计。
6. The system SHALL 显示 Checkpoint 和恢复提示。
7. The system SHALL 支持用户干预输入。
8. The system SHALL 显示错误详情与重试状态。
9. The system SHALL 支持 `/model` 命令切换模型。
10. The system SHALL 支持 `/diag` 命令导出诊断。
11. The system SHALL 支持 `export` 导出为 txt 和 epub。
12. The system SHALL 支持 `import` 导入已有文本。
13. The system SHALL 与 headless 模式共享同一 Runtime。

### Requirement 9: Headless 模式

**User Story:** AS 用户，I want 在无终端环境中使用 headless 模式运行创作，SO THAT 我能在 CI 或远程环境中使用 SynChronicle。

#### Acceptance Criteria

1. The system SHALL 在 `--headless --prompt` 模式下启动新创作。
2. The system SHALL 在 `--headless` 无 prompt 模式下恢复已有会话。
3. The system SHALL 将流式输出发送到 stdout。
4. The system SHALL 将进度和错误信息发送到 stderr。
5. The system SHALL 在运行结束后输出脱敏诊断。
6. The system SHALL 在 headless 模式下支持 `AskUser` 通过 stdin/stderr 交互。

### Requirement 10: 自更新

**User Story:** AS 用户，I want 通过 `synchronicle update` 命令自更新到最新版本，SO THAT 我不需要手动下载。

#### Acceptance Criteria

1. The system SHALL 通过 npm 注册表检查最新版本。
2. WHEN 指定 `update <version>`，the system SHALL 更新到指定版本。
3. WHEN 当前版本已是最新，the system SHALL 输出"已是最新版本"。
4. The system SHALL 在更新成功后输出新版本号。

### Requirement 11: 通知告警

**User Story:** AS 用户，I want 在无人值守模式下收到运行结束和预算告警通知，SO THAT 我能及时了解创作状态。

#### Acceptance Criteria

1. The system SHALL 在 `notify.enabled` 为 true（默认）时发送通知。
2. The system SHALL 支持自定义 `notify.command` 替代系统通道。
3. The system SHALL 支持 `notify.events` 过滤通知类型。
4. The system SHALL 在预算水位到达 `warn_ratio` 时发送告警。
5. The system SHALL 在运行结束时发送通知。
6. The system SHALL 在停靠点暂停时发送通知。

### Requirement 12: 用户规则运行时

**User Story:** AS 用户，I want 在创作过程中注入自定义规则约束，SO THAT 作品符合我的创作偏好。

#### Acceptance Criteria

1. The system SHALL 从 `~/.synchronicle/rules.md` 加载全局用户规则。
2. The system SHALL 从 `./.synchronicle/rules.md` 加载项目级用户规则。
3. The system SHALL 归一化并合并各来源规则。
4. The system SHALL 在启动时生成规则快照到 `meta/user_rules.json`。
5. The system SHALL 支持运行中通过 `save_user_rules` 工具更新规则。

### Requirement 13: 资产与提示词

**User Story:** AS 用户，I want 现有的提示词模板和参考文档在 Node.js 版本中保持不变，SO THAT 创作质量不受迁移影响。

#### Acceptance Criteria

1. The system SHALL 加载 `assets/prompts/` 下的 Coordinator、Architect、Writer 和 Editor 提示词。
2. The system SHALL 加载 `assets/references/` 下的创作参考文档。
3. The system SHALL 加载 `assets/styles/` 下的风格模板。
4. The system SHALL 按配置的 `style` 字段选择对应的风格和题材弧模板。
5. The system SHALL 在 Node.js 环境中使用文件系统读取资产，替代 Go embed。

### Requirement 14: 评测体系

**User Story:** AS 开发者，I want 保留现有评测用例和框架，SO THAT 我能验证迁移后的 Agent 行为质量。

#### Acceptance Criteria

1. The system SHALL 保留 `evals/cases/` 下的评测用例。
2. The system SHALL 保留 `synchronicle eval` 子命令执行评测。
3. The system SHALL 输出评测报告（评分和通过率）。

### Requirement 15: Go 与 Docker 资产清理

**User Story:** AS 维护者，I want 仓库中不再包含 Go 源码和 Docker 配置，SO THAT 仓库结构清晰反映 Node.js 技术栈。

#### Acceptance Criteria

1. The system SHALL 删除全部 `*.go` 源文件。
2. The system SHALL 删除 `go.mod` 和 `go.sum`。
3. The system SHALL 删除 `.goreleaser.yml`。
4. The system SHALL 删除 `Dockerfile` 和 `docker-compose.yml`。
5. The system SHALL 删除 `.github/workflows/docker.yml`。
6. The system SHALL 将 `.github/workflows/release.yml` 替换为 Node.js npm 发布工作流。
7. The system SHALL 删除 `scripts/install.sh` 中的 Go 二进制安装逻辑。
8. The system SHALL 删除 README 中所有 Go、Docker 和二进制归档安装说明。

### Requirement 16: 发布与 CI

**User Story:** AS 维护者，I want 通过 GitHub Actions 和 npm 发布 Node.js 版本，SO THAT 用户能通过 npm 安装。

#### Acceptance Criteria

1. The system SHALL 使用 `pnpm build` 编译 TypeScript 到 ESM。
2. The system SHALL 在 `npm pack` 产物中包含可执行的 `synchronicle` CLI。
3. The system SHALL 在发布包中包含 `README.md`、`LICENSE` 和 `NOTICE`。
4. The system SHALL 在 CI 中执行 `pnpm typecheck`、`pnpm test` 和 `pnpm build`。
5. The system SHALL 在 tag 推送时触发 npm 发布。

### Requirement 17: 文档更新

**User Story:** AS 用户，I want README 反映 Node.js 安装和运行方式，SO THAT 我能快速上手。

#### Acceptance Criteria

1. The system SHALL 更新 README 安装方式为 `npm install -g synchronicle`。
2. The system SHALL 更新 README 的 Node.js 24 LTS 版本要求。
3. The system SHALL 移除 README 中的 Docker 运行说明。
4. The system SHALL 移除 README 中的 Go install 说明。
5. The system SHALL 移除 README 中的二进制归档下载说明。
6. The system SHALL 保留 README 中的配置、命令、输出结构、架构和许可证说明。
7. The system SHALL 保留 `NOTICE` 内容不变。
8. The system SHALL 保留 `LICENSE` 为 Apache License 2.0。
