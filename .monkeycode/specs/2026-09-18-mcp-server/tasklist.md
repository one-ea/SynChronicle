# 实施任务列表：MCP Server

- [ ] 1. 协议层与工具实现
  - R: `src/mcp/index.ts`：createMcpHandler（initialize/initialized/ping/tools list+call）、startMcpServer（readline 行分帧）、六工具（status/book/chapter/diag/run/inject）
  - 零新增依赖；Host 惰性构建；injections.jsonl 用 Host 兼容格式
- [ ] 2. CLI 接入
  - M: `src/cli/parse.ts`（mcp 子命令 + 互斥校验）、`src/cli/dispatch.ts`（分发 startMcpServer）
- [ ] 3. 测试与回归
  - R: `src/mcp/mcp.test.ts`（握手/六工具/isError/未配置/-32601）
  - M: `src/cli/parse.test.ts` 增量
  - `pnpm typecheck && pnpm test && pnpm build` 全绿后提交
