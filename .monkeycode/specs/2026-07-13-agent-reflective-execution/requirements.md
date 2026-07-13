# Agent Reflective Execution Requirements

## Introduction

本功能为 Architect、Writer 和 Editor 的单次任务增加独立评审驱动的执行闭环。系统在每次任务中执行最多三轮“执行、评审、修订”，达到质量阈值后返回结果；达到轮次上限后返回历史最高分版本并携带质量风险信息。

## Glossary

- **Execution Agent**: 执行 Architect、Writer 或 Editor 单次任务的 Agent。
- **Reviewer Agent**: 使用独立模型评估 Execution Agent 结果并生成结构化修订意见的 Agent。
- **Reflective Executor**: 控制执行、评审、修订、候选选择和终止条件的运行时组件。
- **Review Rubric**: 针对 Agent 类型定义的评分维度、权重和通过阈值。
- **Candidate**: 单轮 Execution Agent 产生的结果及其评审记录。
- **Quality Risk**: 最终候选未达到质量阈值或因预算提前结束时附加的结构化风险信息。
- **Staged Artifact**: 在最终候选确定前隔离保存、尚未写入正式作品目录的业务工件。

## Requirements

### Requirement 1: 单次任务反思闭环

**User Story:** AS 创作者, I want 每个专业 Agent 在返回结果前接受独立评审和修订, SO THAT 单次任务输出具备稳定的质量。

#### Acceptance Criteria

1. WHEN Architect、Writer 或 Editor 开始单次任务, the system SHALL 创建独立的反思执行会话。
2. WHEN Execution Agent 产生候选结果, the system SHALL 调用 Reviewer Agent 评估候选结果。
3. WHEN Reviewer Agent 判定候选达到通过阈值, the system SHALL 立即返回当前候选。
4. WHEN Reviewer Agent 判定候选低于通过阈值且剩余修订轮次大于零, the system SHALL 将结构化修订指令提供给 Execution Agent。
5. WHILE 反思执行会话处于运行状态, the system SHALL 将执行与修订总轮数限制为三轮。

### Requirement 2: 独立 Reviewer Agent

**User Story:** AS 创作者, I want 独立模型审查 Agent 结果, SO THAT 评审结论减少执行模型自评偏差。

#### Acceptance Criteria

1. WHEN Reviewer Agent 执行评审, the system SHALL 使用独立于当前 Execution Agent 调用的模型会话。
2. WHEN Reviewer Agent 返回结果, the system SHALL 使用 Zod 校验评分、通过状态、摘要、问题和修订指令。
3. IF Reviewer Agent 返回不符合 Schema 的结果, the system SHALL 在预算允许范围内重试评审。
4. WHILE Reviewer Agent 执行评审, the system SHALL 禁止 Reviewer Agent 调用业务写入工具。
5. WHEN Reviewer Agent 完成评审, the system SHALL 保存评审模型、token、费用和延迟数据。

### Requirement 3: 专用评分量表

**User Story:** AS 项目维护者, I want 不同 Agent 使用专用评分量表, SO THAT 评审标准匹配各 Agent 的职责。

#### Acceptance Criteria

1. WHEN Reviewer Agent 评审 Architect 结果, the system SHALL 评估结构完整性、因果一致性、角色与世界规则一致性及可执行性。
2. WHEN Reviewer Agent 评审 Writer 结果, the system SHALL 评估任务遵循、情节连贯、角色一致性、文风质量、节奏及可读性。
3. WHEN Reviewer Agent 评审 Editor 结果, the system SHALL 评估问题识别覆盖率、证据准确性、建议可操作性及审阅结论一致性。
4. WHEN 项目配置未提供自定义阈值, the system SHALL 使用 85 分作为默认通过阈值。
5. WHEN Reviewer Agent 生成问题, the system SHALL 为每个问题提供维度、严重程度、证据和修订建议。

### Requirement 4: 最佳候选与风险返回

**User Story:** AS 创作者, I want 修订上限后仍能获得最佳结果, SO THAT 创作流程可以继续并保留质量风险依据。

#### Acceptance Criteria

1. WHEN 三轮候选均低于通过阈值, the system SHALL 返回评分最高的候选。
2. WHEN 多个候选具有相同最高分, the system SHALL 返回轮次最新的最高分候选。
3. WHEN 最终候选低于通过阈值, the system SHALL 附加 `quality_threshold_unmet` 风险代码、最终评分和遗留问题。
4. WHEN 预算不足以继续执行, the system SHALL 返回已有最高分候选并附加 `budget_exhausted` 风险代码。
5. WHEN 最终候选达到通过阈值, the system SHALL 返回不含质量风险的结果。

### Requirement 5: 副作用隔离与提交

**User Story:** AS 项目维护者, I want 评审中的候选工件与正式作品隔离, SO THAT 低质量候选不会污染正式数据。

#### Acceptance Criteria

1. WHILE 最终候选尚未确定, the system SHALL 将业务工件写入 Staged Artifact 区域。
2. WHEN 最终候选确定, the system SHALL 仅提交最终候选对应的 Staged Artifact。
3. WHEN 系统提交最终工件, the system SHALL 按“业务工件写入、checkpoint、事件”的顺序完成提交。
4. IF 最终工件提交失败, the system SHALL 保留可恢复状态和失败诊断信息。
5. WHEN 反思执行会话恢复, the system SHALL 继续使用已保存的候选、轮次和评审记录。

### Requirement 6: 事件与可观测性

**User Story:** AS 创作者, I want 查看评审和修订进度, SO THAT 我能理解 Agent 当前的质量改进状态。

#### Acceptance Criteria

1. WHEN 反思执行开始, the system SHALL 发出 `reflection.started` 事件。
2. WHEN Reviewer Agent 完成评审, the system SHALL 发出 `review.completed` 事件并包含轮次、评分和通过状态。
3. WHEN 新一轮修订开始, the system SHALL 发出 `revision.started` 事件并包含轮次和问题摘要。
4. WHEN 反思执行结束, the system SHALL 发出 `reflection.completed` 事件并包含最终轮次、评分和风险状态。
5. WHILE 反思执行运行, the system SHALL 分别统计 Execution Agent 和 Reviewer Agent 的 token、费用及延迟。

### Requirement 7: 配置与兼容性

**User Story:** AS 项目维护者, I want 在保留现有行为的基础上启用反思执行, SO THAT 现有创作流程和数据保持兼容。

#### Acceptance Criteria

1. WHEN 反思执行功能启用, the system SHALL 保持现有 Coordinator、Flow Router 和 Agent 公共调用接口兼容。
2. WHEN 项目加载反思配置, the system SHALL 使用 Zod 校验 Reviewer 模型、通过阈值、最大轮数和重试设置。
3. WHEN 配置未指定最大轮数, the system SHALL 使用三轮作为默认值。
4. WHEN 配置指定最大轮数, the system SHALL 将有效范围限制为一至三轮。
5. WHEN 旧项目配置不包含反思设置, the system SHALL 使用默认配置完成加载。

### Requirement 8: 验证与回归

**User Story:** AS 项目维护者, I want 自动验证反思闭环及原有流程, SO THAT 能力增强具备可证明的正确性。

#### Acceptance Criteria

1. WHEN Reflective Executor 测试运行, the system SHALL 覆盖首次通过、修订通过、三轮上限和最高分选择。
2. WHEN Reviewer Agent 测试运行, the system SHALL 覆盖合法输出、非法输出重试和评审故障。
3. WHEN 副作用隔离测试运行, the system SHALL 验证候选暂存、最终提交和失败恢复。
4. WHEN 运行时集成测试运行, the system SHALL 验证事件顺序、Usage 统计、预算终止和 checkpoint 恢复。
5. WHEN 全量测试运行, the system SHALL 保持现有 Agent、Store、Tools、Host 和 Flow Router 测试通过。
