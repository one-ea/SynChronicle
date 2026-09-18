# Requirements Document

## Introduction

本需求旨在增强 SynChronicle 的多模型协作创作能力与 AI 文风修改能力：
1. **多模型协作完成文章**：在 Web 控制台配置页面提供清晰的角色模型分配面板（规划师 Architect、写手 Writer、编辑 Editor、评审员 Reviewer），允许用户为不同职能独立绑定服务商、模型名称、降级备选（Fallbacks）及推理强度（Reasoning Effort），使各角色在长篇小说创作全生命周期中协同推进。
2. **AI 文风修改与润色**：在阅读器与控制台提供针对指定章节的文风修改（支持 suspense 悬疑 / fantasy 奇幻 / romance 言情 / default 等预设文风与自定义润色提示词），并针对「AI味」检测结果提供定向重写与降味优化，产出新的章节候选并持久化。

## Glossary

- **Coordinator (调度器)**: 顶层协调智能体，负责全书状态推进与子任务下发。
- **Architect (规划师)**: 负责设定、大纲演进与卷弧结构规划的智能体。
- **Writer (写手)**: 负责章节场景细化与正文起草的智能体。
- **Editor (编辑)**: 负责章节审美、连贯性与七维质量评审的智能体。
- **Reviewer (独立评审)**: 在反思阶段对产物进行打分与优化建议的独立角色。
- **AI Tone (AI味)**: 文本中出现的模板化陈词滥调、假大空过渡句及同构句式，通过特征词与规则进行量化评分。
- **Style Rewrite (文风重写)**: 基于选定文风规则与降味指令对目标章节进行重新创作或深度润色。

## Requirements

### Requirement 1: Web 控制台多角色模型协作分配

**User Story:** AS 创作者, I want 在 Web 控制台中直观配置各角色的服务商与模型, so that 我可以让大参数模型负责结构规划，高速高性价比模型负责写稿，高审美模型负责编辑与独立评审。

#### Acceptance Criteria

1. WHEN 用户打开配置页面（Settings Page），系统 SHALL 展示核心调度、规划师、写手、编辑、独立评审的角色模型分配表单。
2. WHEN 用户为某个角色选择或输入自定义 Provider 与 Model 并提交保存，系统 SHALL 校验该 Provider 的凭据有效性并持久化至配置文件。
3. WHILE 创作运行过程中，系统 SHALL 按照已配置的角色模型分派对应的生成请求。
4. IF 某个角色配置了降级备选（Fallbacks）且主模型请求失败，系统 SHALL 自动切换至备选模型完成本轮创作。

### Requirement 2: 章节文风修改与定向重写

**User Story:** AS 创作者, I want 在阅读器界面选择特定文风并一键对章节发起文风修改或重写, so that 消除机械生硬的 AI 语调，提升文章文学质感与题材契合度。

#### Acceptance Criteria

1. WHEN 用户在阅读器中选定某一章节并点击「文风重写 / 润色」，系统 SHALL 提供题材文风选择（default / suspense / fantasy / romance）及补充修改要求输入框。
2. WHEN 用户提交章节文风重写请求，系统 SHALL 派发写手结合上下文、该章节大纲与目标风格生成新的正文版本。
3. WHILE 重写任务进行中，系统 SHALL 在界面实时展示重写生成流与进度状态。
4. IF 用户确认采纳重写版本，系统 SHALL 原子替换当前章节终稿并自动重新计算全书字数与 AI 味评分。

### Requirement 3: AI 味量化诊断与一键降味

**User Story:** AS 创作者, I want 看到章节命中哪些 AI 套话，并能一键针对性去 AI 味, so that 章节正文更加自然生动。

#### Acceptance Criteria

1. WHILE 用户浏览章节详情，系统 SHALL 展示 AI 味评分与命中的高频套话词条列表。
2. WHEN 用户点击「一键去 AI 味」，系统 SHALL 自动将命中的套话模式作为负向约束注入重写指令并启动润色。
3. WHEN 润色完成，系统 SHALL 展示重写前后的 AI 味评分对比及词条消除情况。
