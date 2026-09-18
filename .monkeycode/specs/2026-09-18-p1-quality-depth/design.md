# P1 质量纵深技术设计

Feature Name: p1-quality-depth
Updated: 2026-09-18

## Description

四个增量：嵌入检索（retrieval/embedding.ts + tools 接线 + 配置块）、伏笔红线（diag/foreshadow.ts）、反思候选 API 与记录页卡片、writer/editor 上下文护栏。

## Components and Interfaces

### 1. `src/retrieval/embedding.ts`（新）

```ts
export interface EmbeddingConfig { base_url?: string; model?: string; api_key?: string; dimensions?: number }
export async function embedTexts(config: EmbeddingConfig, texts: string[]): Promise<number[][]>  // POST {base_url}/embeddings
export function cosineSimilarity(a: number[], b: number[]): number
```

- 默认 base_url `https://api.openai.com/v1`、model `text-embedding-3-small`；Bearer 鉴权。
- ConfigSchema 增 `embedding: z.object({...}).optional()`。

### 2. tools.ts 检索接线

- `retrieveRelatedChapters` 增加 `embedding` 参数与进程内向量缓存（Map：chapter → {hash, vector}）。
- 配置存在且取到 key → 语料逐章 embed（缓存命中跳过）+ 查询 embed → 余弦排序；任一步抛错 → 回落 BM25。
- 返回增加 `engine: "embedding" | "bm25"`。

### 3. `src/diag/foreshadow.ts`（新）

```ts
export const FORESHADOW_ABSENCE = 10;
export async function foreshadowFindings(store: Store): Promise<Finding[]>
```

- compass.open_threads → tokenize bigram 集 → 扫描已完成章 `loadChapterText`，命中 ≥2 记提及；断档 = completed - lastMention。
- 两类 finding：`ForeshadowStall.absent`（从未提及且 completed>10）、`ForeshadowStall.stale`（断档 >10）。
- diagnose() 在 pacing 之后追加。

### 4. 反思候选（server + records 页）

- `GET /api/reflection`：`readdir(meta/reflection)` → 每会话读 manifest.json + 各 contentFile 前 160 字 → `{configured, sessions:[{sessionId, rounds:[{round, artifacts:[{id,target,status,preview}]}]}]}`（按会话名倒序）。
- `POST /api/reflection/commit {sessionId, round}`：ids = manifest.artifacts.filter(round && staged) → `store.staging.createSession(sessionId).commit(ids)` → `{committed: n}`；空/不存在 → 400。
- app.ts 记录页新增「反思候选」卡：会话分组渲染轮次与状态药丸（staged/committed），预览 monospace 截断，采纳按钮 → POST → 刷新。

### 5. 文风护栏（tools.ts novel_context）

- writer：`selected_memory.style_guard = { avoid: string[] }`（stylestat patterns 每章 ≥2 的前 5 条 + 三类固定 AI 味名；style_stats 缺席时仅固定三条）。
- editor：草稿存在时返回 `quality_signals: { aitone: detectAitone(draft) }`（null 当无草稿）。

## Correctness Properties

1. 嵌入失败静默回落，检索永不因 embedding 中断 novel_context。
2. 向量缓存键含摘要哈希，摘要变更自动重嵌入。
3. 采纳只作用于显式请求轮次的 staged 工件；已 committed 工件幂等跳过（staging.commit 语义）。
4. style_guard/aitone 注入为纯读扩展，novel_context 既有键不变。

## Error Handling

| 场景 | 行为 |
|---|---|
| embeddings 接口 4xx/5xx/超时 | 回落 BM25，engine 标 bm25 |
| embedding 无 api_key | 视同未配置，直接 BM25 |
| reflection 会话 manifest 损坏 | 该会话跳过并在列表中省略 |
| commit 无 staged 工件 | 400 "该轮没有可采纳的候选" |

## Test Strategy

1. embedding.test.ts：mock fetch（确定性向量）验证余弦排序、错误回落、缓存命中（fetch 调用次数）。
2. foreshadow.test.ts：stale/absent/新鲜三态 + 无 compass 跳过。
3. web.test.ts：播种 manifest+content → GET 列表字段、POST commit 落盘到 chapters/01.md、空轮 400。
4. tools.test.ts 增量：editor 分支含 quality_signals.aitone（含疲劳词草稿）、writer 分支含 style_guard.avoid。

## References

[^1]: (src/store/staging.ts#L246-L248) — 会话目录/manifest/state 路径
[^2]: (src/tools/tools.ts#L82-L96) — novel_context 分支注入点
[^3]: (src/agents/reflection/rubrics.ts) — 文风维度现状（style_guard 为其数据底座）
