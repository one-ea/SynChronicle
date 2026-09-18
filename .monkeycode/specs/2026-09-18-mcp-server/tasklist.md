# 实施任务列表：MCP Server

- [x] 1. 协议层与工具实现
  - R: `src/mcp/index.ts`：createMcpHandler（initialize/initialized/ping/tools list+call）、startMcpServer（readline 行分帧）、六工具（status/book/chapter/diag/run/inject）
  - 零新增依赖；Host 惰性构建；injections.jsonl 用 Host 兼容格式（{text, time}）
- [x] 2. CLI 接入
  - M: `src/cli/parse.ts`（mcp 子命令 + 互斥校验）、`src/cli/dispatch.ts`（分发 startMcpServer）
- [x] 3. 测试与回归
  - R: `src/mcp/mcp.test.ts`（5 用例：握手/六工具/isError/inject 落盘 + mock host run/未配置）
  - M: `src/cli/parse.test.ts` 增量（mcp 解析与互斥）
  - 全量 50 文件 / 372 用例全绿 + 构建成功 + dist 产物 stdio 冒烟通过
