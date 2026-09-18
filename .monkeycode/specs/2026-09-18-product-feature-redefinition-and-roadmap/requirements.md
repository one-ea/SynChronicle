# Requirements Document: 功能体系重定义与演进规划

## Introduction

本规格将 SynChronicle 现有的所有功能模块重新梳理归类，打破以往零碎分散的工具呈现，重构为以创作者心智为核心的四大系统支柱（创作引擎、质量控制、沉浸工坊、开放生态），并定义未来下一代核心功能蓝图。

## Glossary

- **SynChronicle Core Engine (核心创作引擎)**: 驱动从一句话 brief 到数百万字宏大世界的长篇自主叙事状态机与多模型协作中枢。
- **Quality Fortress (质量堡垒系统)**: 融合静态统计、AI 味雷达、节奏红线、全书大纲自洽性的多维质量门禁体系。
- **Immersive Studio (沉浸创作工坊)**: 面向作家的沉浸式阅读、多端精修、即时文风重塑与实时偏航打断交互界面。
- **Open Nexus (开放连接枢纽)**: 自定义接口桥接、零依赖 MCP 服务与工件双向导入导出的生态基石。

## Requirements: 现有功能体系重组与重新定义

### Pillar 1: 创世与协同中枢 (Creation & Multi-Agent Orchestration)

**User Story:** AS 创作者, I want 一个层级分明、职责清晰的多智能体写作中枢, so that 我能清晰掌控小说结构推进并合理分配模型算力。

#### Acceptance Criteria

1. **灵感孵化与任务调度 (Brief to Engine)**:
   - WHEN 用户在创作面板提交灵感 brief, 系统 SHALL 唤起调度智能体（Coordinator）并完成世界观与核心矛盾初始化。
2. **多模型专业化角色分配 (Multi-Model Specialization)**:
   - WHILE 配置模型时, 系统 SHALL 允许用户为规划师 (Architect)、写手 (Writer)、编辑 (Editor)、独立评审 (Reviewer) 独立绑定最优模型或备选链路 (Fallbacks)。
3. **断点持久化与零中断恢复 (Stateful Checkpoint & Resume)**:
   - WHEN 遭遇进程终止或异常中断, 系统 SHALL 依靠原子 Checkpoint 记录从上一有效状态一键无缝恢复。
4. **实时偏航打断重定向 (Realtime Steer Redirection)**:
   - WHEN 用户发现情节偏航, 系统 SHALL 支持一键打断当前生成并回滚至目标章节注入新指令重写。

### Pillar 2: 质量评估与文风重构 (Quality Fortress & Stylistic Refactor)

**User Story:** AS 创作者, I want 确定性的质量诊断指标与灵活的文风重构能力, so that 生成正文彻底杜绝生硬 AI 味并契合特定题材风格。

#### Acceptance Criteria

1. **AI 味量化雷达与词条拦截 (Anti-AI-Tone Radar)**:
   - WHILE 章节正文生成或阅读, 系统 SHALL 实时扫描量词癖、虚词癖、套句等高频模式，并计算百分制 AI 味评分。
2. **题材风格定向重构 (Genre Stylistic Transformation)**:
   - WHEN 用户选定章节并指定风格（悬疑/奇幻/言情/通用）, 系统 SHALL 自动提取风格描写准则与负向约束，生成重写候选。
3. **节奏红线与结构诊断 (Pacing & Structural Diagnostics)**:
   - WHEN 触发全书诊断, 系统 SHALL 分析支线占比、叙事停滞与伏笔回收率，输出严重度分级报告。
4. **独立评审与多轮反思采纳 (Reviewer Staging & Adoption)**:
   - WHEN 章节初稿完成后, 独立评审 SHALL 按七维指标打分，未达标时在暂存区生成优化轮次供用户确认采纳。

### Pillar 3: 沉浸式阅读工坊 (Immersive Studio & Reader)

**User Story:** AS 创作者, I want 现代、沉浸、无干扰的阅读与结构审阅界面, so that 能够如同读实体书一般检阅小说。

#### Acceptance Criteria

1. **卷-弧-章三层大纲树 (Layered Outline Navigation)**:
   - WHILE 用户进入章节阅览, 系统 SHALL 结构化渲染卷主题、弧目标与章节挂载树，清晰标识草稿/终稿/待重写状态。
2. **前台阅读纯净视图 (/read Front)**:
   - WHEN 用户打开独立阅读前台, 系统 SHALL 提供仿书排版、章节平滑切换与深浅主题自适应。
3. **双向导入导出矩阵 (Format Matrix)**:
   - WHEN 用户需要归档或迁移, 系统 SHALL 支持将全书导出为 TXT/EPUB 电子书，或通过绝对路径反向切分导入旧作。

### Pillar 4: 开放生态与扩展 (Open Nexus & Ecosystem)

**User Story:** AS 开发者与高级用户, I want 自由连接任意 API 并通过外部智能体操控小说工坊, so that 写作能力可被无限扩展。

#### Acceptance Criteria

1. **纯自定义端点桥接 (Universal Custom Endpoint)**:
   - WHEN 连接模型服务, 系统 SHALL 支持任意 OpenAI 兼容端点、Anthropic 协议与 Google 原生协议，告别平台绑定。
2. **标准化 MCP 写作服务 (Model Context Protocol)**:
   - WHEN 接入外部 Agent（如 Claude Desktop/Cursor）, 系统 SHALL 通过 Stdio 暴露章节查询、全书大纲、诊断与干预等原子工具。

---

## Future Roadmap: 下一代新功能规划蓝图

### Phase 2: 知识库与网状人物图谱 (Knowledge Graph & Entity Memory)
- **人物关系与心境演变图谱**: 自动从已完成章节提炼人物性格、势力归属与好感度动态变化网状图。
- **伏笔生命周期看板**: 视效化追踪每个伏笔的“埋设-暗示-假象-收束”状态，未收线时发出完结红线预警。

### Phase 3: 协同创作与章节 A/B 竞赛 (Creative Arena & Forking)
- **多模型同章竞写 (A/B Generation)**: 由 Writer-A（如 Claude）与 Writer-B（如 DeepSeek）同时起草同一章节，Editor 进行盲审并给出融合建议。
- **分支剧情推演 (Branching Narrative Tree)**: 允许在关键弧线分裂出 if 线平行世界，支持独立推进与随时合并。

### Phase 4: 多模态视听衍生 (Multimodal Transmedia)
- **AI 插画与场景分镜卡**: 提取章节核心场景与人物外观，自动调用生图模型绘制配套插图。
- **角色立绘与有声旁白生成**: 为重要角色绑定声线，一键导出带情绪配音的有声小说。
