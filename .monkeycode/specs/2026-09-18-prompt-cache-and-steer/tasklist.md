# 实施任务列表：Prompt 缓存与运行时 Steer 引导

- [x] 1. Prompt 缓存增强（优化 `src/agents/agent.ts` 的 `withCacheBreakpoint`，确保静态前缀与动态末尾的双重缓存策略）
- [x] 2. 运行时 Steer 核心流（在 `Host` 实现 `steer` 方法，覆盖 abort、草稿与状态回滚、干预注入与自动 resume）
- [x] 3. Web 服务与 API 暴露（新增 `POST /api/steer`，并在控制台概览区集成 Steer 交互按钮与弹窗）
- [x] 4. MCP 工具扩展（在 `src/mcp/index.ts` 注册 `synchronicle_steer` 工具并更新类型测试）
- [x] 5. 单元测试与全量自动化验证（host.test.ts、web.test.ts、mcp.test.ts、全量 384 个用例回归通过）
