# 需求实施计划: P3 协同创作与章节 A/B 竞赛

- [ ] 1. 剧情分支管理核心数据模型与存储
  - [ ] 1.1 创建 `src/domain/branch.ts` 剧情分支类型规范
    - 定义 `StoryBranch` 基础数据接口与分支状态
  - [ ] 1.2 创建 `src/store/branches.ts` 存储操作集
    - 实现 `createBranch`, `listBranches`, `getBranchContent`, `mergeBranchToMain` 等操作
  - [ ] 1.3 为分支管理编写单元测试 `src/store/branches.test.ts`
    - 针对分支创建、隔离修改与主干合并编写测试用例

- [ ] 2. A/B 竞写调度与盲审对比引擎
  - [ ] 2.1 创建 `src/runtime/arena.ts`
    - 实现双候选并行生成、盲审对比打分以及胜出者判定算法
  - [ ] 2.2 编写 `src/runtime/arena.test.ts` 单元测试
    - 验证盲审对比维度打分与获胜者裁定逻辑

- [ ] 3. 检查点 - 确保底层模型与分支存储测试全部通过
  - 确保所有测试通过，如有疑问请询问用户

- [ ] 4. 服务端 API 路由扩展
  - [ ] 4.1 在 `src/web/server.ts` 增加 `/api/chapters/:chapter/arena` 接口
  - [ ] 4.2 在 `src/web/server.ts` 增加 `/api/chapters/:chapter/branches` 与 `/checkout` 接口
  - [ ] 4.3 编写服务端 A/B 竞写与分支操作的集成单测

- [ ] 5. Web 控制台与阅读器交互升级
  - [ ] 5.1 章节详情页新增「A/B 竞写」对比弹窗与采纳按钮
  - [ ] 5.2 章节详情页新增「剧情分支」列表与一键 Fork / 切换视图
  - [ ] 5.3 运行全量构建与端到端回归验证，更新运行服务
