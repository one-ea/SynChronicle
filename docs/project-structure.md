# 项目结构

SynChronicle 是一个 Node.js 24+、TypeScript、Vercel AI SDK 驱动的多智能体长篇创作引擎。

```text
.
├── src/                 运行时代码与单元测试
│   ├── agents/          Coordinator、Architect、Writer、Editor
│   ├── assets/          提示词与参考资料加载
│   ├── cli/             CLI 入口、参数解析与命令分发
│   ├── config/          JSONC 配置加载、合并、校验
│   ├── domain/          领域模型与运行时事实 schema
│   ├── eval/            评测收集、判定与报告
│   ├── providers/       模型适配、映射与 failover
│   ├── runtime/         Host 生命周期、恢复、预算与观察
│   ├── store/           作品、状态、摘要与 checkpoint 持久化
│   ├── tools/           Agent 工具注册与创作工具
│   └── tui/             Ink/React 交互界面
├── assets/              随 npm 发布的 prompt、参考资料与风格文件
├── evals/               版本化评测案例和 rubric
├── docs/                架构、运行机制与历史设计记录
├── scripts/             安装脚本与辅助脚本
├── config.example.jsonc 配置示例（唯一维护入口）
├── dist/                构建产物（本地生成，不提交）
└── package.json         npm 包、脚本与依赖定义
```

## 常用命令

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
npm pack --dry-run
```

本地没有启用 Corepack 时，也可以直接使用 `node_modules/.bin/tsc`、`node_modules/.bin/vitest` 和 `node_modules/.bin/tsup` 进行验证。

## 目录约定

- **业务代码只放在 `src/`**，测试与被测模块同目录，使用 `*.test.ts(x)` 命名。
- **Prompt 和写作知识放在 `assets/`**；新增参考资料后，按 [assets 内容地图](../assets/README.md) 接入角色白名单。
- **用户配置和作品输出不进仓库**：分别位于 `.synchronicle/` 与 `output/`，并已加入 `.gitignore`。
- **构建产物不作为源码维护**：`dist/` 由 `pnpm build` 生成，npm 发布时由 CI 构建。
- **迁移/任务记录不参与运行时**：历史记录保存在 `.monkeycode/`、`.superpowers/`，默认不纳入版本控制。
