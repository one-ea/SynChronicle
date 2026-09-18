# Requirements Document: P3 协同创作与章节 A/B 竞赛 (Creative Arena & Story Forking)

## Introduction

Phase 3 聚焦于增强 SynChronicle 的高阶创作竞技与分支叙事探索能力：
1. **多模型同章竞写 (A/B Generation Arena)**：允许为同一章节派发两个异构模型（例如模型 A 与模型 B）并行创作正文候选，交由 Editor / Reviewer 自动盲审对比其文风、节奏与立意，创作者可在界面直接对比评分与全文差异并一键采纳。
2. **剧情轻量分支推演 (Story Forking)**：允许创作者在小说关键转折章一键创建平行 if 线分支，在分支中尝试不同的走向与剧情演进，随时无损切换主干与分支。

## Glossary

- **Candidate A / Candidate B (候选正文 A / B)**: 两个异构模型针对同一章节大纲和上下文生成的独立正文版本。
- **Blind Review (盲审对比)**: 在隐藏模型身份的前提下，由评审模型对两版正文在文风质感、情节张力、AI味指数、逻辑自洽等维度进行客观评分与优缺点分析。
- **Story Branch (剧情分支)**: 从主干衍生出的独立剧情线，拥有分支专属的章节正文、摘要与独立大纲记录。

## Requirements

### Requirement 1: 章节多模型 A/B 竞写与自动盲审

**User Story:** AS 创作者, I want 为重要章节同时派发两个不同风格/厂商的模型进行同题竞写并查看自动评审对比, so that 我能博采众长、挑选最佳版本或激发更好的写作灵感。

#### Acceptance Criteria

1. WHEN 用户在章节详情页点击「发起 A/B 竞写」, 系统 SHALL 允许选择参与竞写的模型 A 与模型 B（默认为当前写手主模型与备选模型）。
2. WHEN A/B 竞写启动, 系统 SHALL 并行生成两份完整的章节候选草稿。
3. WHILE 候选草稿生成完成, 系统 SHALL 自动调用评审模块对比两篇正文的字数、AI 味扣分项及情节亮点，输出盲审对比卡片。
4. WHEN 用户确认采纳某一候选, 系统 SHALL 将该候选原子替换为该章终稿并更新全书统计。

### Requirement 2: 剧情分支推演与主干切换

**User Story:** AS 创作者, I want 在关键冲突章创建平行分支进行探索, so that 我可以试验「如果主角做了相反抉择」的不同走向而无需担心破坏主干进度。

#### Acceptance Criteria

1. WHEN 用户在某一章节点击「创建剧情分支 (Fork)」, 系统 SHALL 为该章创建一条新分支（如 `branch-chX-alt`）并建立副本隔离。
2. WHILE 处于分支状态, 用户对该章的修改与后续推进 SHALL 仅记录在当前分支中。
3. WHEN 用户在分支看板中选择「合并/切换为主干」, 系统 SHALL 原子同步该分支内容至主章节目录。
