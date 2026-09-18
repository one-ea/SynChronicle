# 需求实施计划: Phase 2 知识网络、实体图谱与 MCP 增强

- [ ] 1. 实体图谱核心数据模型与存储
  - [ ] 1.1 创建 `src/domain/entity.ts` 实体与关系类型规范
    - 定义 `Entity` (人物、势力、关键道具) 与 `EntityRelation` (羁绊、对立、从属) 数据接口
    - 定义 `CharacterState` 心境动态演变轨迹模型
  - [ ] 1.2 创建 `src/store/entities.ts` 存储操作集
    - 实现 `loadEntities`, `saveEntities`, `upsertEntity`, `linkRelation` CRUD 方法
    - 实现并发文件锁与原子写入防丢失机制
  - [ ]* 1.3 为实体存储模块编写单元测试
    - 针对实体去重、增量合并与非法关系处理编写测试用例

- [ ] 2. 伏笔生命周期追踪与预警模型
  - [ ] 2.1 扩展伏笔模型 `ForeshadowState` 于 `src/domain/foreshadow.ts`
    - 支持「埋设 (planted) - 暗示 (hinted) - 误导 (misled) - 收束 (resolved)」四阶段状态机
  - [ ] 2.2 在 `src/diag/foreshadow.ts` 增加未收线伏笔逾期门禁
    - 当全书进度进入终章或收官卷时，自动生成 `ForeshadowLeak` 严重级诊断报警
  - [ ]* 2.3 编写伏笔状态机与诊断报警单元测试
    - 验证各生命周期合法流转与跨弧逾期检测

- [ ] 3. 检查点 - 确保模型与存储层测试全部通过
  - 确保所有测试通过，如有疑问请询问用户

- [ ] 4. 增强 MCP 写作工具箱 (Model Context Protocol 提升)
  - [ ] 4.1 在 `src/mcp/index.ts` 暴露 `synchronicle_rewrite` 章节重写与去 AI 味工具
    - 允许外部 IDE/Agent 直接传入目标文风与负向指令调用重写引擎
  - [ ] 4.2 在 `src/mcp/index.ts` 暴露 `synchronicle_entities` 人物与关系图谱工具
    - 允许外部 Agent 按角色查询关联羁绊与出场章节历史
  - [ ]* 4.3 编写 MCP 新增工具调用的握手与执行单测
    - 针对 `synchronicle_rewrite` 与 `synchronicle_entities` 编写 mock 链路测试

- [ ] 5. Web 控制台与阅读器交互升级
  - [ ] 5.1 在 Web 前台新增「人物与势力图谱」可视化看板
    - 展示核心人物卡片、好感羁绊力导向关系以及心境弧度走势
  - [ ] 5.2 接入章节内联选区润色与局部去 AI 味接口
    - 支持创作者选中特定段落发起靶向文风修改，无需重写整章
  - [ ] 5.3 构建发布产物并完成端到端回归验证
    - 执行 `pnpm typecheck && pnpm test && pnpm build` 确认功能闭环
