# 实施任务列表：P1 质量纵深

- [x] 1. 嵌入语义检索
  - R: `src/retrieval/embedding.ts`（embedTexts/cosineSimilarity/embeddingEndpoint，fetch + 30s 超时）
  - M: ConfigSchema 增可选 `embedding` 块；tools.ts 检索接线（语料向量按 章节号+摘要哈希 进程内缓存，失败静默回落 BM25，返回 engine 标记）
  - 测试：embedding.test.ts（3 用例：端点/错误/余弦）
- [x] 2. 伏笔到期提醒
  - R: `src/diag/foreshadow.ts`（FORESHADOW_ABSENCE=10，bigram 命中 ≥2 记提及，stale/absent 两类 warning）
  - M: diagnose() 在 pacing 之后追加
  - 测试：foreshadow.test.ts（3 用例）
- [x] 3. 反思候选采纳
  - R: `GET /api/reflection`（会话/轮次/工件/预览，contentFile 为 store 根相对路径）、`POST /api/reflection/commit`（sessionId 白名单校验 + 轮次 staged 工件提交）
  - M: 记录页「反思候选」卡（轮次药丸 + 预览 title + 采纳此轮按钮）
  - 测试：web.test.ts（列表字段、采纳落盘 chapters/01.md、重复采纳 400）
- [x] 4. 文风护栏注入
  - M: novel_context writer 分支 `selected_memory.style_guard.avoid`（stylestat 高频 top5 + 固定三类）；editor 分支 `quality_signals.aitone`（草稿命中明细）
  - 测试：tools.test.ts 增量用例
- [x] 5. 全量回归与提交
  - 52 文件 / 380 用例全绿 + 构建成功；演示库补 compass（scripts/seed-demo.mjs 同步）
