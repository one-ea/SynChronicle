# 需求文档：P1 质量纵深四件套

Feature Name: p1-quality-depth
Updated: 2026-09-18

## 引言

P1 批次：向量嵌入检索（BM25 升级）、伏笔到期提醒（diag）、反思候选采纳（Web）、文风护栏注入（Agent 上下文）。全部保持"警示不拦截"与只读旁路原则（候选采纳除外——它是显式用户动作）。

## 需求

### R1 嵌入语义检索

1. WHEN 配置含 `embedding` 块（base_url/model/api_key）, writer 的相关章节检索 SHALL 改用 OpenAI 兼容 `/embeddings` 接口做余弦相似度 top-k，SHALL 在接口失败时自动回落 BM25 并标记 engine。
2. WHEN 未配置 embedding, 系统 SHALL 保持 BM25 行为，响应字段标记 engine:"bm25"。
3. 语料向量 SHALL 按（章节号 + 摘要哈希）进程内缓存，摘要未变时 SHALL 复用向量。
4. 嵌入实现 SHALL 保持零新增依赖（fetch + JSON）。

### R2 伏笔到期提醒

1. WHEN diagnose 运行且 compass.open_threads 非空, 系统 SHALL 对每条伏笔在已完成章正文中检索最近提及章（线索 bigram 命中 ≥2 视为提及）。
2. IF 伏笔距最近提及超过 10 章或从未被提及且已完成 > 10 章, 系统 SHALL 产出 warning 级 ForeshadowStall finding（evidence 含线索与断档计数）。
3. IF 无 compass 或 open_threads 为空, 检查 SHALL 跳过。

### R3 反思候选采纳

1. `GET /api/reflection` SHALL 列出暂存会话：每会话含各轮工件（round/target/status）与正文预览（前 160 字）。
2. `POST /api/reflection/commit`（sessionId + round）SHALL 将该轮全部 staged 工件经 staging.commit 落盘，返回提交数。
3. IF 指定轮无 staged 工件或会话/轮次不存在, 系统 SHALL 返回 400 与明确错误。
4. 记录页 SHALL 展示反思候选卡（轮次、目标、状态、预览）并提供「采纳此轮」操作。

### R4 文风护栏注入

1. WHEN writer 请求 novel_context, 系统 SHALL 在 selected_memory 注入 style_guard：来自 stylestat 的高频模式（每章 ≥2 次，至多 5 条）+ 固定三类 AI 味模式名，作为本章规避清单。
2. WHEN editor 请求 novel_context 且草稿存在, 系统 SHALL 注入 quality_signals.aitone（该章 detectAitone 得分与命中），供评审引用原文举证。
3. 注入 SHALL 只扩展返回字段，既有字段契约保持不变。

### R5 兼容性

1. 既有测试套件 SHALL 全部通过；ConfigSchema 新增 `embedding` 可选块 SHALL 缺省兼容旧配置。
