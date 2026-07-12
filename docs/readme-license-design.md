# README 与许可证更新设计

- Date: 2026-07-12
- Status: Approved
- Scope: README、视觉资源、Apache-2.0 版权信息、NOTICE、发布包

## 目标

为 SynChronicle 建立一份全新的产品首页型 README，并统一仓库、发布包和 GitHub 展示中的 Apache License 2.0 信息。

## README 结构

README 控制在约 180 至 250 行，按以下顺序组织：

1. 项目名称、一句话定位和状态徽章。
2. 核心能力。
3. 多智能体工作流程。
4. 快速安装。
5. 最小配置示例。
6. 启动方式和常用命令。
7. 作品输出结构。
8. 架构概览。
9. Docker 使用。
10. 本地开发与验证。
11. 数据和密钥安全。
12. Apache-2.0 许可证与版权声明。

README 面向首次接触项目的用户，优先回答项目用途、安装方式、运行方式、配置位置和产物位置。高级架构细节通过 `docs/` 文档承载。

## 视觉资源

删除以下历史视觉资源及其 README 引用：

- `scripts/sample.gif`
- `scripts/novel.png`

新 README 不嵌入旧截图或 GIF。后续品牌视觉可作为独立设计任务添加。

## 配置示例

README 使用最小 JSONC 示例，包含：

- 默认 provider。
- 默认 model。
- provider 类型。
- API Key 占位符。
- Base URL 示例。

示例不得包含真实密钥，也不得引用 Agent 环境变量。用户配置路径使用：

- `~/.synchronicle/config.json`
- `./.synchronicle/config.json`

## 许可证

继续使用 Apache License 2.0 标准正文。`LICENSE` 保持 SPDX 可识别的标准文本，不加入会破坏自动识别的自定义前言。

新增 `NOTICE`：

```text
SynChronicle
Copyright 2026 one-ea

Licensed under the Apache License, Version 2.0.
```

README 许可证章节使用：

```text
Apache License 2.0
Copyright 2026 one-ea
```

## 发布包

GoReleaser archive 同时包含：

- `README.md`
- `LICENSE`
- `NOTICE`

品牌契约测试验证 README、NOTICE 和 GoReleaser 文件清单一致。

## README 内容要求

- 标题使用 `# SynChronicle`。
- 一句话定位聚焦“多智能体 AI 长篇创作引擎”。
- 徽章链接指向 `one-ea/SynChronicle`。
- 安装脚本、Go install、Release 和 Docker 示例使用当前仓库与产物名称。
- 命令示例使用 `synchronicle`。
- 配置目录使用 `.synchronicle`。
- License 明确为 Apache-2.0。
- 不引用已删除的视觉资源。
- 不包含旧项目品牌和旧配置路径。

## 验证

```bash
go test ./internal/brand -count=1
go test ./...
go vet ./...
go build -o /tmp/opencode/synchronicle ./cmd/synchronicle
sh -n scripts/install.sh
git diff --check
```

若环境存在 GoReleaser，再执行：

```bash
goreleaser check
```

还需验证：

- README 行数位于目标范围。
- README 中所有仓库内相对路径均存在。
- README 不引用删除后的图片。
- `NOTICE` 内容与批准版权信息完全一致。
- GitHub 继续识别许可证为 Apache-2.0。
