# SynChronicle

多智能体 AI 长篇创作引擎。SynChronicle 由 Coordinator 驱动 Architect、Writer 与 Editor 协作完成规划、写作、评审和持续演进，把一句创作需求推进为可恢复、可干预的完整长篇作品。

[![Go](https://img.shields.io/github/go-mod/go-version/one-ea/SynChronicle)](https://github.com/one-ea/SynChronicle)
[![Release](https://img.shields.io/github/v/release/one-ea/SynChronicle)](https://github.com/one-ea/SynChronicle/releases)
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

macOS 和 Linux 可使用安装脚本：

```bash
curl -fsSL https://raw.githubusercontent.com/one-ea/SynChronicle/main/scripts/install.sh | sh
```

安装指定版本：

```bash
curl -fsSL https://raw.githubusercontent.com/one-ea/SynChronicle/main/scripts/install.sh | sh -s -- v1.2.3
```

已有 Go 1.25.5 或更高版本时，可直接安装：

```bash
go install github.com/one-ea/SynChronicle/cmd/synchronicle@latest
```

Windows 用户可从 [GitHub Releases](https://github.com/one-ea/SynChronicle/releases/latest) 下载对应归档包。

检查安装结果：

```bash
synchronicle --version
synchronicle --help
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

## 启动与常用命令

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
|-- chapters/          章节正文
|-- drafts/            写作草稿
|-- outline/           大纲与卷弧规划
|-- characters/        角色档案与状态
|-- reviews/           Editor 评审结果
|-- summaries/         章、弧、卷摘要
`-- meta/              运行状态与 checkpoints
```

产物采用可直接阅读和检查的本地文件保存。备份整个作品目录即可保留正文、规划和恢复状态。

移除 `output/` 会清除当前目录下的创作进度，请在操作前完成备份。

## 架构概览

SynChronicle 遵循“LLM 驱动，Host 服务”的运行模型：

- `cmd/synchronicle` 提供 CLI、TUI 和 headless 入口。
- `internal/host` 管理启动、恢复、事件与运行生命周期。
- `internal/agents` 构建 Coordinator、Architect、Writer 和 Editor。
- `internal/tools` 提供原子化创作工具及 checkpoint 边界。
- Store 持久化正文、摘要、状态、评审和上下文工件。

深入设计文档：

- [运行时架构](docs/architecture.md)
- [上下文管理](docs/context-management.md)
- [可观测性](docs/observability.md)
- [评测体系](docs/evaluation-system.md)
- [用户规则运行时](docs/user-rules-runtime.md)
- [提示词缓存设计](docs/prompt-cache-design.md)

## Docker

直接运行镜像：

```bash
docker run --rm -it \
  -v "$HOME/.synchronicle:/root/.synchronicle" \
  -v "$PWD:/workspace" \
  -w /workspace \
  ghcr.io/one-ea/synchronicle:latest
```

使用仓库中的 Compose 配置：

```bash
docker compose run --rm synchronicle
```

Headless 模式：

```bash
docker compose run --rm synchronicle --headless --prompt "写一本悬疑短篇"
```

容器中的配置目录映射到主机 `~/.synchronicle`，作品数据映射到当前工作目录。

## 本地开发

克隆仓库并运行：

```bash
git clone https://github.com/one-ea/SynChronicle.git
cd SynChronicle
go run ./cmd/synchronicle
```

执行项目验证：

```bash
go test ./...
go vet ./...
go build ./cmd/synchronicle
sh -n scripts/install.sh
```

发布配置采用 GoReleaser v2，归档包含可执行文件、`README.md`、`LICENSE` 和 `NOTICE`。

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
