# assets 内容地图

给系统加"一段话 / 一篇资料 / 一条规则"之前，先查下表确定归属，再看接线方式。

| 目录 | 装什么 | 谁消费 | 接线方式 |
|---|---|---|---|
| `prompts/` | 常驻角色 system prompt（coordinator / writer / editor / architect×2）与一次性任务 prompt（import×2 / simulation×2） | `src/agents/build.ts` 装配；imp / sim runner | `src/assets/load.ts` loadAssets 读 Prompts。注意：simulation_guidance 由 `load.ts` 的 `withSimulationGuidance` 加载时注入，md 文件里看不到 |
| `references/` | 题材无关的写作知识材料。不进 system prompt，由 novel_context 按角色裁剪后注入 `reference_pack` | writer / editor / architect | `loadAssets` 读 references + `src/tools/tools.ts` novel_context 按角色白名单注入（writer 写作纪律三篇 / architect 规划组 / editor 评审组；白名单见 `REFERENCE_BY_ROLE`）。新增参考资料后如需被消费，把 `loadAssets` 的 key 加进对应角色白名单 |
| `references/genres/<style>/` | 题材专属知识（style-references / arc-templates） | 同上，`style != default` 时加载 | `src/assets/load.ts` loadAssets 按 `style` 追加读取 |
| `rules/` | 已废弃的旧内置规则目录；机械基线已迁到代码，用户规则来自 `~/.synchronicle/rules/*.md` / `./.synchronicle/rules/*.md` 的自然语言快照 | `src/rules/index.ts`（rawFileSources → normalizeRule → buildSnapshot）归一化为 `meta/user_rules.json`；`novel_context` 注入；`commit_chapter` 检查 | 内置基线见 `src/rules/index.ts` 的 `systemDefaults()`；用户 `.md` 零格式、零 YAML，按自然语言归一化 |
| `styles/<style>.md` | 题材写作风格指令 | 拼进 **writer** 的 system prompt（`src/agents/build.ts` writerSystem） | 文件名即 `config.style` 取值。与 `references/genres/<style>/` 是同一题材概念的两种载体：前者是风格指令，后者是知识材料 |

## 新内容归属判断（五问）

1. 这个流程必须被**保证**？→ 不写 prompt，写代码约束（工具守卫 / Flow Router `src/runtime/flow/router.ts`）
2. 这是裁定判据（什么时候派谁）？→ `prompts/coordinator.md`
3. 这是某个角色的审美 / 执行标准？→ `prompts/<role>.md`
4. 这是可机械枚举的默认规则（禁词 / 字数 / 阈值）？→ `src/rules/index.ts` 的 `systemDefaults()`；用户自定义规则写进 `.synchronicle/rules/*.md`，由归一化快照消费
5. 这是写作知识材料？→ `references/`（记得把新文件 key 加进 `REFERENCE_BY_ROLE` 白名单才会被注入）

## 一致性保障

prompt 引用的信封路径（`working_memory.*` 等）与 writer.md 的 commit_chapter 参数文档
由 `src/assets/assets.test.ts` 机检——这两类漂移不报错、只让模型悄悄变笨，靠测试红灯暴露。
prompt 里的流程段是"用户手册"，流程真理在代码层；两者脱节时以代码为准并回头修 prompt。
