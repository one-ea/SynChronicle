# Platform Model Capabilities Catalog

## Goal

升级平台模型配置，使每个平台模型拥有结构化能力目录，并在配置写入与运行时调用两处强制门禁，从而可靠控制可用模型与可调参数。

## Scope

- 扩展 `platform_models` 的结构化能力字段，Admin 可完整编辑。
- 建立共享 capability schema 与 `assertSelectionAllowed` 校验库。
- 模型集创建/修订、运行创建、模型切换、Worker/Host 调用前复用同一套门禁。
- 目录 API、设置页可用性、工作台模型选择器展示能力摘要。
- Admin 模型 API 接受并校验 `capabilities`。
- 数据库 migration 与历史行回填。
- 单测、Postgres 条件测试，以及现有 model-set / quota / admin 回归。

## Out of Scope

- 远端 Provider/OpenRouter 自动同步能力。
- 角色级 `requiredCapabilities` 策略引擎与智能路由。
- 完整 Admin 可视化表单构建器（本期以结构化 API 与只读/轻量展示为主；若现有 Admin UI 可扩展则同步展示）。
- 修改配额结算账本语义（价格未知拦截继续保留，并与能力门禁并列）。
- CLI/本地单机配置文件体系重写（Worker 应用 run snapshot 时走同一校验函数即可）。

## Current State

- `platform_models` 存 provider、model、status、input/output price、credentialReference、自由 `metadata`。
- 模型集校验只检查 provider/model 是否在目录、凭证是否匹配；参数几乎无能力边界。
- 运行时主要拦截未知平台价格；`ModelRegistry` 仅有本地 baseline 规格，未与平台目录打通。
- 参数模型已存在雏形：`temperature`、`maxTokens`、`reasoningEffort`。

## Design Principles

1. **Admin 权威**：平台模型能力以数据库中的 Admin 配置为准。
2. **一等字段**：`capabilities` 为结构化列，不把完整能力契约继续塞进杂项 `metadata`。
3. **共享门禁**：配置路径与运行时路径调用同一校验实现，避免旁路。
4. **安全默认**：缺失或未声明字段取保守默认，宁可拒绝也不静默扩大能力。
5. **硬失败**：非法选择与越权参数返回明确错误，不静默钳制或降级。
6. **租户隔离保持不变**：用户凭证、模型集、run 配置仍按 `userId` 隔离。

## Architecture

```text
Admin API ──write──> platform_models.capabilities
                         │
                         ▼
              Model Capability Catalog
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
 model-set validate   run/model switch   Worker/Host preflight
        │                │                │
        └────────────────┴────────────────┘
                         │
              assertSelectionAllowed()
```

### Core Module

新增共享模块（建议路径 `src/models/capabilities.ts`，可按仓库习惯微调）：

- `PlatformModelCapabilitiesSchema`：Zod 契约
- `defaultPlatformModelCapabilities()`：安全默认
- `normalizePlatformModelCapabilities(input)`：解析 + 默认填充
- `assertSelectionAllowed(selection, catalogEntry)`：统一门禁
- `catalogEntryFromPlatformRow(row)`：从 DB 行投影目录项

所有校验错误使用稳定错误码字符串，便于 API 映射与测试断言，例如：

- `model_unavailable`
- `capability_unsupported`
- `parameter_out_of_range`
- `credential_policy_violation`
- `unknown_price`

## Data Model

### Table: `platform_models`

新增列：

| Column | Type | Notes |
|--------|------|-------|
| `capabilities` | `jsonb not null default '{}'::jsonb` | 结构化能力；应用层以 Zod 规范化后再写入 |

保留：

- `input_price` / `output_price`：计费主字段（与现网一致）
- `metadata`：运维杂项，如 `priceStatus`、`credentialOwnerId`；不再作为能力契约来源
- `status`、`credential_reference`

### Capability Schema

```ts
{
  contextWindow: number;          // > 0
  maxOutputTokens: number;        // > 0
  pricing: {
    inputPer1M: number;           // >= 0，与列同步或由列投影
    outputPer1M: number;          // >= 0
    cacheReadPer1M?: number;      // >= 0
    cacheWritePer1M?: number;     // >= 0
  };
  modalities: {
    text: boolean;                // default true
    vision: boolean;              // default false
    audio: boolean;               // default false
  };
  tools: {
    toolCalling: boolean;         // default false
    structuredOutput: boolean;    // default false
    jsonMode: boolean;            // default false
  };
  generation: {
    streaming: boolean;           // default true
    temperature: { min: number; max: number }; // default 0..2
    reasoningEffort: Array<"low" | "medium" | "high">; // default []
    systemPrompt: boolean;        // default true
  };
  policy: {
    allowPlatformCredential: boolean; // default true
    allowUserCredential: boolean;     // default true
    tags: string[];                   // default []
  };
}
```

### Safe Defaults

当 Admin 创建模型时未提供完整 `capabilities`：

1. 用 schema + defaults 规范化。
2. `pricing.inputPer1M` / `pricing.outputPer1M` 从 `inputPrice` / `outputPrice` 投影。
3. 未声明的增强能力（vision/audio/toolCalling/structuredOutput/jsonMode/reasoningEffort）取 **false / 空数组**。
4. 未声明 `contextWindow` / `maxOutputTokens` 时使用保守占位，并要求 Admin 在生产启用前补齐；或在 `active` 写入时强制二者为正整数（推荐：**active 模型必须具备正整数 contextWindow 与 maxOutputTokens**）。

### Migration / Backfill

1. 增加 `capabilities jsonb not null default '{}'`。
2. 回填现有行：
   - `pricing` 从价格列投影
   - 其余字段填安全默认
   - 若 `metadata` 已含可识别的 context/maxTokens 等字段，可在 migration 中最佳努力映射；无法识别则用默认
3. 应用层读路径始终 `normalizePlatformModelCapabilities`，兼容历史空对象。
4. 写路径只持久化规范化后的对象。

`metadata.priceStatus === "unknown"` 规则保持：未知价格模型对平台调用不可用。

## Catalog Read Model

### Catalog Entry

```ts
{
  provider: string;
  model: string;
  status: "active" | "disabled";
  capabilities: PlatformModelCapabilities;
  priceKnown: boolean;
  credentialSource?: "environment" | "encrypted"; // public 响应不泄露 reference 原文
}
```

### Availability

平台模型对终端用户可选当且仅当：

1. `status === "active"`
2. `priceKnown === true`（现有 `hasKnownPlatformPrice`）
3. 能力已规范化且通过 schema
4. 若使用平台凭证路径：`policy.allowPlatformCredential === true`
5. 若使用用户凭证路径：`policy.allowUserCredential === true`，且凭证 provider 匹配

### API Surface

**Admin**

- `POST/PATCH /api/admin/models`：`ModelInput` 增加可选/必填 `capabilities`（create 可部分提供，服务端 normalize；update 支持 partial merge + normalize）
- `GET /api/admin/models`：返回规范化后的 `capabilities`（仍剥离 `credentialReference` 原文，仅暴露 source 类型）

**用户目录 / 投影**

- `ModelConfigurationRepository.catalog` / `projection`：每个平台模型附带公开能力子集：
  - `contextWindow`、`maxOutputTokens`
  - `modalities`、`tools`、`generation`（含 temperature 范围与 reasoning 档位）
  - `policy` 中的 allow flags 与 tags
  - 不暴露内部 credential 细节

**设置页用量**

- `platformModels` 可用性条目可附加简短 reason：`disabled` / `unknown_price` / `incomplete_capabilities`（若启用强制完整规格）

## Dual Gate Enforcement

### Gate A — Configuration Time

触发点：

1. 创建/修订用户模型集（`validateModelSetInput`）
2. 启动 run 时绑定 model set snapshot
3. 工作台/API 模型切换请求校验

规则：

- 选择的 `provider/model` 必须在可用目录中。
- `parameters.temperature` 必须落在模型 `generation.temperature` 范围内（若提供）。
- `parameters.maxTokens` 必须 `<= capabilities.maxOutputTokens`（若提供）。
- `parameters.reasoningEffort` 必须属于 `generation.reasoningEffort`（若提供；模型不支持 reasoning 时拒绝任何 effort）。
- 提供 `credentialId` 时要求 `policy.allowUserCredential`；未提供时平台路径要求 `policy.allowPlatformCredential`。
- 若调用链声明需要 tool calling / vision 等（后续可扩展），本期至少在参数与凭证策略上强制；Agent 工具启用状态若超出模型 `tools.toolCalling`，在运行时 Gate B 再拦截。

### Gate B — Runtime Preflight

触发点：

1. Worker 应用 run configuration snapshot 之前/之时
2. Host `switchModel` 持久化前
3. 平台模型工厂创建 `quotaGuardedModel` 前（与价格检查并列）

规则：

- 重新加载当前平台目录行（以 DB 为准，避免使用过期客户端投影）。
- 复用 `assertSelectionAllowed`。
- 失败分类为 **不可重试配置错误**（对齐现有 `invalid_config` / 4xx 语义）。
- **禁止静默钳制**：例如不允许把 `maxTokens` 偷偷改成上限后继续。

### Error Mapping

| Context | HTTP / command | Message intent |
|---------|----------------|----------------|
| model-set API | 400 | Invalid model configuration / capability violation |
| run create | 400 | configuration rejected |
| model switch command | command.error, non-retryable | capability/parameter rejected |
| worker preflight | fail task/command with invalid_config | selection no longer allowed |

## Parameter Handling

现有参数契约保持字段名兼容：

```ts
parameters?: {
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
}
```

增强：

- 校验对照 `capabilities.generation` 与 `maxOutputTokens`。
- Host/ModelSet 继续把 `temperature`/`maxTokens` 传入 generation options。
- `reasoningEffort` 若模型支持，则在 provider adapter 层按现有/扩展映射透传；不支持则门禁在进入 adapter 前失败。

## Frontend / UX

### Admin

- 列表与详情展示关键能力摘要（context、max output、tools、reasoning、凭证策略）。
- 创建/更新可通过 API 提交完整 `capabilities`；若已有 Admin UI，优先做结构化字段，避免鼓励随意 metadata。

### Settings

- 平台模型可用性继续展示 available/unavailable。
- 不可用原因区分价格未知与能力不完整（若适用）。

### Workbench

- Provider/模型下拉的可选项仅来自可用目录。
- 选中模型后展示只读能力提示：context、max tokens、温度范围、是否支持 reasoning/tools。
- 参数控件按能力裁剪：不支持 reasoning 时隐藏 effort；temperature 输入遵守 min/max。

不改变现有移动/平板/桌面布局契约。

## Testing Strategy

### Unit

- capabilities schema：合法、非法、默认填充。
- `assertSelectionAllowed`：模型不可用、参数越界、reasoning 不支持、凭证策略冲突。
- `validateModelSetInput` 集成能力门禁。
- Admin ModelInput 接受/拒绝 capabilities。
- migration normalize：空对象与部分对象。

### Postgres conditional

- Admin create/update 持久化 capabilities。
- catalog/projection 返回能力字段。
- 价格未知与 disabled 仍不可选。
- run/model-set 路径在 DB 中拒绝非法参数。

### Regression

- 现有 modelConfig、admin、usage availability、worker configuration、quota known-price 测试保持绿色。
- Workbench 选择器在能力裁剪后的交互单测（如有 UI 改动）。

## Rollout

1. 落地 schema + 共享模块 + migration/backfill。
2. Admin 写路径 normalize。
3. catalog/model-set Gate A。
4. Worker/Host Gate B。
5. 设置页/工作台读模型展示与控件裁剪。
6. 文档与进度台账更新。

## Success Criteria

1. Admin 可为每个平台模型写入完整结构化能力。
2. 终端用户目录只暴露 active + 价格已知 + 策略允许的模型，并附带能力摘要。
3. 模型集与模型切换无法保存超出能力的参数。
4. Worker/Host 即使收到陈旧 snapshot，也会在调用前拒绝越权选择。
5. 未知价格与能力门禁同时生效，行为可测、错误可分类。

## Non-Goals Recap

不在本期实现自动模型同步、基于 requiredCapabilities 的智能路由，或参数静默降级。
