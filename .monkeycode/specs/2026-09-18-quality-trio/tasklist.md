# 实施任务列表：质量三件套

- [ ] 1. BM25 模块与 writer 上下文注入
  - R: `src/retrieval/bm25.ts`（tokenize/bm25Search，纯函数，k1=1.5 b=0.75，CJK bigram）
  - M: `src/tools/tools.ts` novel_context writer 分支：摘要语料（排除最近 3 章窗口）+ 大纲查询 → selected_memory.related_chapters（top 3）
  - 测试：bm25.test.ts + tools.test.ts 增量
- [ ] 2. 反 AI 味检测
  - R: `src/stylestat/aitone.ts`（detectAitone：五类词表、0-100 得分、hits/samples）
  - M: `/api/chapters/:n` 附带 aitone；控制台阅读器 + /read 前台徽标（score ≥ 70 warn 色）
  - 测试：aitone.test.ts + web.test.ts 增量
- [ ] 3. 节奏红线诊断
  - R: `src/diag/pacing.ts`（PACING_LIMITS 5/10/15，pacingFindings → warning Findings）
  - M: diagnose() 追加接入
  - 测试：pacing 触发/不触发用例
- [ ] 4. 全量回归与收尾
  - `pnpm typecheck && pnpm test && pnpm build` 全绿；tasklist 勾选；README 质量特性段落
