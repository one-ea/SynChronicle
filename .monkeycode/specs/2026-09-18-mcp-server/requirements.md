# 需求文档：MCP Server（stdio）

Feature Name: mcp-server
Updated: 2026-09-18

## 引言

把 SynChronicle 引擎能力暴露为 Model Context Protocol 工具，供 Claude、OpenCode 等 MCP 宿主直接查询作品状态、读章节、跑诊断、发起创作与注入干预。这是"深耕单机创作工具 + Agent 生态接口"（方向 C）的落地，对标 emdash/Vela/InkOS 的 MCP/skill 能力。

## 术语

- **MCP**：Model Context Protocol，JSON-RPC 2.0 消息协议；stdio 传输为按行分隔的 UTF-8 JSON。
- **宿主（Host）****：连接 MCP server 的客户端（Claude Desktop、OpenCode 等）。
- **工具（Tool）**：MCP 暴露给宿主的可调用能力，含 name/description/inputSchema。

## 需求

### R1 stdio 传输与握手

**User Story:** AS MCP 宿主, I WANT 通过 stdio 与 SynChronicle 通信, SO THAT 无 HTTP 依赖地集成创作引擎。

#### 验收标准

1. `synchronicle mcp [--config path]` 子命令 SHALL 启动 stdio MCP server，按行读取 JSON-RPC 2.0 消息、按行写回响应。
2. WHEN 收到 `initialize` 请求, 系统 SHALL 返回 protocolVersion、`capabilities.tools` 与 serverInfo；WHEN 收到 `notifications/initialized`, 系统 SHALL 保持静默（通知无响应）。
3. WHEN 收到 `tools/list`, 系统 SHALL 返回六个工具的 name/description/inputSchema。
4. WHEN 收到 `ping`, 系统 SHALL 返回空结果。
5. WHEN 收到未知方法, 系统 SHALL 返回 JSON-RPC 错误 -32601。

### R2 只读工具

**User Story:** AS 外部 Agent, I WANT 查询作品状态/大纲/章节/诊断, SO THAT 在写作建议前掌握全书事实。

#### 验收标准

1. `synchronicle_status` SHALL 返回 configured、phase、章节进度、字数与模型信息。
2. `synchronicle_book` SHALL 返回卷弧章三层树与四态章节状态。
3. `synchronicle_chapter`（参数 chapter 正整数）SHALL 返回正文（终稿优先）、摘要、评审维度与 AI 味得分；IF 章节号非法 SHALL 返回工具级错误（isError）。
4. `synchronicle_diag` SHALL 返回 diagnose 报告（stats + findings）。
5. 未配置模型时, 只读工具 SHALL 返回 configured:false 与空数据，SHALL 以进程错误退出。

### R3 动作工具

**User Story:** AS 外部 Agent, I WANT 发起/继续创作并注入干预, SO THAT 在宿主会话里驱动长篇生产。

#### 验收标准

1. `synchronicle_run`（参数 prompt 非空）SHALL 惰性构建 Host 并异步启动 startPrepared/continue，立即返回 started:true 与当前状态。
2. `synchronicle_inject`（参数 text 非空）SHALL 以 Host 兼容格式追加 `meta/injections.jsonl`（{text, time}），在下一次 run 开头送达。
3. IF 未配置模型, 动作工具 SHALL 返回工具级错误与配置指引。
4. 动作工具 SHALL 与 Web 控制台共享同一 Store 目录与注入文件格式。

### R4 CLI 兼容与质量

1. `mcp` 子命令 SHALL 支持 `--config`；WHEN 与 `--headless`/`--prompt`/`--port` 等启动参数混用 SHALL 报互斥错误。
2. 既有 CLI 行为与测试套件 SHALL 全部保持通过。
3. MCP 实现 SHALL 保持零新增运行时依赖。
