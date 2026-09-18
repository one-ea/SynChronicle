# 需求文档：质量三件套（BM25 检索 / 反 AI 味 / 节奏红线）

Feature Name: quality-trio
Updated: 2026-09-18

## 引言

竞品调研（InkOS、Webnovel Writer、AI_NovelGenerator 等）显示语义检索、反 AI 味工程化、读者向节奏指标是同类项目的标配能力。本规格把三项质量能力以最小侵入方式接入 SynChronicle，强化"以生成文章质量为特色"的定位：检索补齐长篇一致性短板，检测与红线把质量问题变成可见、可度量的信号。执行策略统一为**警示不拦截**。

## 术语

- **BM25**：经典词频相关性打分算法；本实现为纯 TS 零依赖，中文按字符二元组（bigram）分词。
- **相关章节检索**：以当前章大纲为查询，在已完成章的摘要语料上检索最相关的历史章节。
- **selected_memory**：novel_context 中 writer 专属的上下文分区，承载按需检索的内容。
- **AI 味（AI tone）**：疲劳词表（量词癖/虚词癖/明喻套句/对比定义句式/抽象大词等）命中所代表的模板化文风。
- **疲劳词表**：机械可枚举的 AI 味模式清单，与 `assets/references/anti-ai-tone.md` 的可枚举条目同源。
- **节奏红线**：主线连续章数、感情线断档章数、世界观扩展断档章数的阈值（5/10/15，源自 Webnovel Writer 的业界实践）。
- **strand_history / hook_history**：progress 中逐章记录的主导叙事线与钩子类型历史。

## 需求

### R1 BM25 相关章节检索

**User Story:** AS Writer 智能体, I WANT 拿到与当前章最相关的历史章节摘要, SO THAT 写作时能引用远处伏笔与旧设定，缓解摘要窗口覆盖不到的长程遗忘。

#### 验收标准

1. WHEN writer 请求 novel_context 且已完成章 ≥ 2, 系统 SHALL 以当前章大纲（标题+核心事件+钩子）为查询，对已完成章摘要做 BM25 检索，并在 `selected_memory.related_chapters` 注入至多 3 个结果（章节号、标题、摘要、相关度分）。
2. WHEN 检索结果与既有摘要窗口重叠, 系统 SHALL 排除窗口内章节，优先注入窗口外的相关章节。
3. IF 已完成章 < 2 或大纲缺失, 系统 SHALL 返回空结果且 novel_context 其余字段保持不变。
4. BM25 实现 SHALL 保持零运行时依赖（纯 TS，中文 bigram 分词，k1=1.5、b=0.75）。

### R2 反 AI 味检测（警示不拦截）

**User Story:** AS 关注文风的创作者, I WANT 看到每章的 AI 味得分与命中词, SO BEFORE 发布前知道哪些模板腔需要改。

#### 验收标准

1. 系统 SHALL 提供逐章 AI 味检测函数：输入正文，输出 0-100 得分与命中明细（模式名、次数、示例片段）。
2. WHEN 章节详情 API（GET /api/chapters/:n）返回且正文存在, 响应 SHALL 附带 `aitone` 字段（score + hits）。
3. WHEN 控制台阅读器或前台阅读页展示章节, 系统 SHALL 以徽标展示 AI 味得分与命中数最多的模式名。
4. 检测 SHALL 只读旁路：commit_chapter、save_review 等写入路径的行为保持不变。
5. 词表 SHALL 覆盖 anti-ai-tone.md 中可机械枚举的五类：量词癖、虚词癖、明喻套句、对比定义句式、抽象大词。

### R3 节奏红线诊断

**User Story:** AS 连载创作者, I WANT 系统提示主线拖沓或感情线失踪, SO THAT 及时调整章节配比避免读者流失。

#### 验收标准

1. 系统 SHALL 从 progress（strand_history/hook_history）与 compass（open_threads）计算三项红线：主导线连续章数 > 5、同一叙事线连续缺席 > 10 章、主线整体断档 > 15 章。
2. WHEN diagnose 运行且任一红线越界, 系统 SHALL 产出 severity 为 warning 的 PacingStall finding，evidence 含具体计数。
3. IF strand_history 为空或章数不足, 系统 SHALL 跳过节奏检查且 diagnose 其余规则保持不变。

### R4 兼容性

**User Story:** AS 既有用户, I WANT 升级后行为无回归, SO THAT 平滑获得新能力。

#### 验收标准

1. 既有测试套件 SHALL 全部通过；检索、检测、红线 SHALL 限于读取 Store 与扩展返回内容。
2. novel_context 既有字段（working_memory/episodic_memory/reference_pack）的契约 SHALL 保持不变。

## 参考

- 竞品模式来源：Webnovel Writer 节奏红线与 BM25 兜底策略、InkOS 反 AI 味工程化、AI_NovelGenerator 向量检索。
- 词表同源：assets/references/anti-ai-tone.md §二（用词 AI 味）。
