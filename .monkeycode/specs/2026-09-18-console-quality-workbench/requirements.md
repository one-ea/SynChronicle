# 需求文档：控制台质量工作台（阶段一）

Feature Name: console-quality-workbench
Updated: 2026-09-18

## 引言

SynChronicle 定位为**以生成文章质量为特色的单机创作工具**。运行时（多智能体、反思闭环、检查点、诊断）能力已完整，本阶段把这些能力接入 Web 控制台：章节阅读、实时流式输出、运行诊断、导入导出、配置管理与暗色主题，让用户"看得见每一章的质量"。

## 术语

- **控制台（Console）**：`src/web` 提供的本地 Web 界面。
- **阅读器（Reader）**：章节与大纲视图，含正文、摘要、评审评分。
- **大纲树**：卷（Volume）→ 弧（Arc）→ 章（Chapter）的分层结构，数据源 `layered_outline.json`，扁平兜底 `outline.json`。
- **章节状态**：`completed`（已提交终稿）/ `in-progress`（进行中）/ `pending`（待写）/ `rewrite`（待重写）。
- **章节评审（Review）**：Editor 通过 `save_review` 落盘的 `reviews/{NN}.json`，含维度分数（dimension/score/verdict/comment）与总结论（verdict）。
- **反思评分（Reflection）**：Reviewer Agent 对候选工件的轮级评审，事件含 round/score/passed。
- **SSE**：Server-Sent Events，服务端到浏览器的单向推送通道。
- **Diag 报告**：`src/diag/diagnose.ts` 产出的结构化诊断（stats + findings，按严重度分级）。
- **脱敏配置视图**：隐藏 `api_key` 真实值后的配置展示。

## 需求

### R1 图书只读 API

**User Story:** AS 控制台用户, I WANT 通过 API 获取整本书的结构与进度, SO THAT 阅读器能渲染大纲树与章节列表。

#### 验收标准

1. WHEN 收到 `GET /api/book`, 系统 SHALL 返回 `{ configured, book }`，其中 book 含 `novelName`、`phase`、`completedChapters`、`totalChapters`、`totalWordCount`、`pendingRewrites`、`inProgressChapter` 与卷弧章三层树（含每章 `chapter/title/status/wordCount`）。
2. WHEN 分层大纲存在, 系统 SHALL 以 `layered_outline.json` 构建树；WHEN 分层大纲为空且扁平大纲存在, 系统 SHALL 以 `outline.json` 构建单卷单弧兜底树。
3. WHEN 未配置模型, 系统 SHALL 返回 `configured:false` 且 `book:null`，并保持 HTTP 200。
4. WHEN 配置已存在但作品目录为空（首次创作前）, 系统 SHALL 返回空树与零计数， SHALL 以错误页面响应。

### R2 章节详情 API

**User Story:** AS 控制台用户, I WANT 获取单章正文、摘要与评审, SO THAT 在阅读器中评估这一章的质量。

#### 验收标准

1. WHEN 收到 `GET /api/chapters/{n}`, 系统 SHALL 返回该章 `title`、`status`、`wordCount`、`text`（终稿优先、草稿兜底）、`summary`（章节摘要）、`outlineEntry`（核心事件与钩子）、`review`（最近一次评审的维度分数、总结论、摘要）。
2. WHEN 指定章节无任何文本, 系统 SHALL 返回 `text:null` 与 `status:"pending"`。
3. WHEN 章节号超出正整数范围, 系统 SHALL 返回 400。

### R3 章节阅读器

**User Story:** AS 创作者, I WANT 在"章节与大纲"页浏览与切换章节, SO THAT 像读书一样检阅成稿。

#### 验收标准

1. WHEN 用户打开阅读器, 系统 SHALL 展示大纲树（左）与章节内容（右），并默认选中最近完成的章节。
2. WHEN 创作进行中, 系统 SHALL 在大纲树以视觉标记区分 `completed/in-progress/pending/rewrite` 四种状态（颜色 + 图形双通道）。
3. WHEN 用户切换章节, 系统 SHALL 拉取章节详情并展示正文、字数、摘要与评审维度分数。
4. WHEN 作品尚未开始（空树）, 系统 SHALL 展示引导空态并链接回概览页。

### R4 质量信息呈现

**User Story:** AS 关注质量的用户, I WANT 看到每章的评审分数与反思轮次趋势, SO THAT 掌握全书质量水位。

#### 验收标准

1. WHEN 章节详情含评审数据, 系统 SHALL 展示各维度分数条、总结论与评审摘要。
2. WHEN 反思事件发生（review_completed 等）, 系统 SHALL 在概览与运行记录中展示轮次、分数与通过状态。
3. WHILE 反思评分低于通过阈值, 系统 SHALL 以警示色标注该轮分数。

### R5 SSE 实时通道

**User Story:** AS 用户, I WANT 事件与正文增量实时推送, SO THAT 免轮询地看到创作现场。

#### 验收标准

1. WHEN 浏览器连接 `GET /api/stream`, 系统 SHALL 以 `text/event-stream` 响应，先发送 `snapshot` 事件，随后转发 `runtime`（运行事件）与 `delta`（正文增量）事件，并以不高于 5 秒间隔发送 `snapshot` 心跳。
2. WHEN 多个客户端同时连接, 系统 SHALL 通过服务端单一消费、扇出广播的方式保证每个客户端收到全部事件。
3. WHEN SSE 连接中断, 客户端 SHALL 自动重连；WHEN 重连失败超过一次, 客户端 SHALL 退化为 `/api/status` 轮询。
4. WHEN Host 尚未创建（未开始创作）, `/api/stream` SHALL 仅发送 snapshot 与心跳。

### R6 概览页流式正文

**User Story:** AS 用户, I WANT 看到 Writer 正在书写的文字流, SO THAT 实时感知生成过程。

#### 验收标准

1. WHILE 引擎运行中, 概览页 SHALL 展示流式正文面板并持续追加增量。
2. WHEN 运行边界到达（run_end）, 系统 SHALL 保留面板内容并标记"本轮已完成"。
3. WHEN 引擎空闲, 系统 SHALL 折叠流式面板。

### R7 运行记录与诊断

**User Story:** AS 用户, I WANT 查看事件流水与诊断报告, SO THAT 排查运行问题。

#### 验收标准

1. WHEN 用户打开运行记录页, 系统 SHALL 展示事件时间线（类型、时间、消息）。
2. WHEN 用户请求诊断, 系统 SHALL 调用 `GET /api/diag` 展示 stats 与 findings，并以警示样式高亮严重级别条目。
3. WHEN 诊断产出为空（无 findings）, 系统 SHALL 展示"未发现结构问题"。

### R8 导入与导出

**User Story:** AS 用户, I WANT 在控制台导入已有文本或导出成稿, SO THAT 衔接既有创作与发布。

#### 验收标准

1. WHEN 用户提交导出请求（格式 txt/epub，可选章节区间）, 系统 SHALL 生成文件并返回 `{ path, chapters }`。
2. WHEN 用户提交导入路径, 系统 SHALL 反推入库并返回 `{ chapters }`。
3. WHEN 无可导出章节或导入解析失败, 系统 SHALL 返回 400 与明确错误信息。

### R9 配置管理

**User Story:** AS 用户, I WANT 在配置页查看与修改核心配置, SO THAT 不动手编辑 JSON 即可调模型。

#### 验收标准

1. WHEN 用户打开配置页, 系统 SHALL 脱敏展示当前配置（api_key 仅显示是否已设置）。
2. WHEN 用户修改核心字段（provider/model/roles 各角色模型）并保存, 系统 SHALL 校验、合并写回并保留其余字段（budget/notify/reflection 原样）。
3. WHEN 校验失败, 系统 SHALL 返回 400 与字段级错误信息，且配置文件保持原值。

### R10 暗色主题

**User Story:** AS 深夜写作的用户, I WANT 暗色界面, SO THAT 长时间阅读不刺眼。

#### 验收标准

1. WHEN 系统偏好为暗色, 控制台 SHALL 默认启用暗色 M3 令牌组。
2. WHEN 用户手动切换主题, 系统 SHALL 立即生效并持久化选择（localStorage），手动选择优先于系统偏好。
3. WHILE 暗色主题启用, 所有文本对比度 SHALL 满足 4.5:1。

### R11 向后兼容

**User Story:** AS 既有用户, I WANT 升级后原有入口照常工作, SO THAT 平滑过渡。

#### 验收标准

1. 既有 API（`/api/status|events|config|run|continue|resume|inject|health`）契约 SHALL 保持不变。
2. CLI、headless、TUI 行为 SHALL 保持不变。
3. 既有测试套件 SHALL 全部通过。
