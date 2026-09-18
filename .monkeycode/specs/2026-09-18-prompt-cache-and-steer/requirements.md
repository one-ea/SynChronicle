# Requirements Document: Prompt Cache & Steer Control

## Introduction

为 SynChronicle 提供高性价比的长篇运行体验：
1. **Prompt 缓存**：对 Anthropic/OpenAI 等支持前缀缓存的模型，在 system 基础设定及长篇上下文前缀打上断点，大幅压低长篇创作的 token 成本与首字延迟。
2. **Steer 运行时打断与重写**：当生成偏航或需要调整方向时，允许直接打断运行中的创作、回滚至指定或上一 checkpoint、带上用户引导 prompt 立即重新开始续写。

## Glossary

- **Cache Breakpoint**：在大模型请求消息中注入的 `cache_control: { type: "ephemeral" }` 标记，用于命中服务商的前缀提示词缓存。
- **Steer**：运行中由用户主动发起的引导动作，包含当前执行打断、检查点回退以及携带偏航校正提示词的重启恢复。
- **Checkpoint Rollback**：将 progress、draft 与 chapters 状态安全回退至指定章节提交前，清理脏草稿与未确认状态。

## Requirements

### Requirement 1: Prompt 缓存多端点支持

**User Story:** 作为长篇小说创作者，我希望长篇生成时自动复用已生成大纲与前序章节上下文的提示词缓存，以减少等待时间和 API 费用。

#### Acceptance Criteria

1. WHEN 构建 Anthropic 消息列表，系统 SHALL 为静态 system prompt 以及最后一条稳定历史上下文附加 `cache_control: { type: "ephemeral" }`。
2. WHILE 使用支持自动前缀缓存的模型（如 OpenAI/DeepSeek），系统 SHALL 保持静态系统提示词与世界设定位于 prompt 前部以提高前缀命中率。
3. IF 配置中声明了非缓存模型，系统 SHALL 正常发送原始消息且不得抛出协议异常。

### Requirement 2: 运行时 Steer 打断与回滚恢复

**User Story:** 作为创作者，当发现正在生成的章节偏航时，我希望一键打断、退回上一章并注入修正意见继续写，而不需要手动改文件或等待当前错误章节完整生成。

#### Acceptance Criteria

1. WHEN 用户通过 `/api/steer` 发送引导请求，系统 SHALL 立即终止当前正在进行的生成（若处于运行态）。
2. WHEN 请求指定目标章节或默认上一 checkpoint 时，系统 SHALL 将 progress 与未完成草稿回退到该检查点对应状态。
3. WHEN 回滚完成后，系统 SHALL 将 steer 提示词作为 `[用户干预]` 注入并自动拉起续写。
4. IF 当前没有可回退的 checkpoint，系统 SHALL 返回 400 明确提示不可回滚。

### Requirement 3: Web 控制台与 MCP 联动

**User Story:** 作为用户，我希望在控制台概览区与 MCP 工具中直接使用 Steer，直观掌控生成节奏。

#### Acceptance Criteria

1. WHEN 打开 Web 控制台概览页，系统 SHALL 在运行中或暂停状态下提供“打断并重定向 (Steer)”交互。
2. WHEN 在 MCP 客户端调用 `synchronicle_steer`，系统 SHALL 执行相同的打断、回退与续写逻辑并返回结构化执行结果。
