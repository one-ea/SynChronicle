# Platform Model Capabilities Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Layer a structured capability catalog into `platform_models`, enforce it at config-time and runtime via a shared `assertSelectionAllowed` guard, and surface capabilities in Admin APIs, user-facing catalog projections, settings availability, and workbench model selectors.

**Architecture:** A single shared module (`src/models/capabilities.ts`) defines the Zod schema, defaults, normalization, and the dual-gate predicate. Every read path normalizes; every write path persists the normalized object; every gate calls the same function. A Drizzle migration adds the `capabilities` jsonb column and backfills existing rows. Admin routes accept/return `capabilities`. Catalog/projection surfaces a public capability subset. Worker/Host preflight re-checks against current DB state.

**Tech Stack:** TypeScript (strict), Zod, Drizzle ORM + PostgreSQL jsonb, Vitest, Playwright (responsive only), Fastify, React.

## Global Constraints

- Node.js 24 LTS, pnpm 10, TypeScript strict, ESM.
- All business data isolated by `userId`.
- Database migration via Drizzle (`drizzle/meta/_journal.json`, `drizzle/` SQL files).
- TDD: write failing test first, run it, implement, run to green, commit.
- PostgreSQL conditional tests gated by `TEST_DATABASE_URL`.
- Existing model-set, admin, usage, scheduler, worker, and workbench tests must stay green.
- `platform_models.metadata` continues to hold `priceStatus`, `credentialOwnerId`, and other ops debris; `capabilities` is the new structured home.
- Active platform models require positive `contextWindow` and `maxOutputTokens` in capabilities (enforced at Admin write time when `status` is `active`).

## File Structure

```
src/models/
  capabilities.ts          (NEW) — schema, defaults, normalize, assertSelectionAllowed
  capabilities.test.ts     (NEW) — unit tests for schema & gates

src/db/schema/providers.ts (MODIFY) — add capabilities column to platformModels Drizzle table

drizzle/
  0017_<tag>.sql            (NEW) — migration: ALTER TABLE platform_models ADD COLUMN capabilities jsonb NOT NULL DEFAULT '{}'::jsonb; backfill
  meta/0017_snapshot.json   (NEW) — drizzle snapshot
  meta/_journal.json        (MODIFY) — append migration entry

src/web/admin/routes.ts     (MODIFY) — ModelInput adds capabilities; publicModel includes capabilities
src/web/admin/admin.test.ts (MODIFY) — test capabilities in Admin API

src/web/providers/modelConfig.ts    (MODIFY) — ModelCatalog entry includes capabilities; validateModelSetInput integrates Gate A
src/web/providers/modelConfig.test.ts (MODIFY) — test capability-aware validation
src/web/providers/repository.ts     (MODIFY) — catalog/projection include capabilities; backfill on read
src/web/providers/modelConfig.postgres.test.ts (MODIFY) — test DB persistence of capabilities-aware sets
src/web/providers/routes.test.ts    (MODIFY) — test model-set API rejects capability violations

src/scheduler/repository.ts (MODIFY) — validateModelSelection checks capabilities; enqueueRun snapshots capabilities
src/web/runs/routes.ts      (MODIFY) — model switch API validates capabilities
src/web/runs/routes.test.ts (MODIFY) — API-level capability rejection tests

src/worker/configuration.ts        (MODIFY) — applyRunConfiguration integrates Gate B
src/worker/configuration.test.ts   (MODIFY) — test run configuration rejects invalid params
src/worker/runner.test.ts          (MODIFY) — test capability gates in runner

src/web/usage/routes.ts      (MODIFY) — platformModelAvailability surfaces capabilities
src/web/usage/usage.test.ts  (MODIFY) — test availability with capabilities

src/web/client/pages/settings.tsx   (MODIFY) — display capabilities summary per model
src/web/client/pages/settings.test.tsx (MODIFY) — verify capability rendering
src/web/client/workbench/runSidebar.tsx (MODIFY) — model dropdown trims by capability, shows hints
src/web/client/workbench/workbench.test.tsx (MODIFY) — verify capability-trimmed UI

src/models/index.ts          (MODIFY) — ModelEntry may absorb capabilities projection (optional)
src/db/schema.test.ts        (MODIFY) — ensure capabilities column exists in schema

src/web/workbench/routes.test.ts   (MODIFY) — workbench projection includes capabilities
```

---

### Task 1: Capabilities Schema and Assertion Module

**Files:**
- Create: `src/models/capabilities.ts`
- Create: `src/models/capabilities.test.ts`

**Interfaces:**
- Produces: `PlatformModelCapabilitiesSchema` (Zod), `PlatformModelCapabilities` (type), `defaultPlatformModelCapabilities()`, `normalizePlatformModelCapabilities(input: unknown): PlatformModelCapabilities`, `CatalogEntry` (type), `assertSelectionAllowed(selection, catalogEntry, policy)`, error codes as string constants.

- [ ] **Step 1: Write the failing test**

```typescript
// src/models/capabilities.test.ts
import { describe, expect, it } from "vitest";
import {
  PlatformModelCapabilitiesSchema,
  defaultPlatformModelCapabilities,
  normalizePlatformModelCapabilities,
  assertSelectionAllowed,
  CATALOG_ENTRY_SCHEMA,
} from "./capabilities.js";

describe("PlatformModelCapabilitiesSchema", () => {
  it("accepts full capabilities", () => {
    const input = {
      contextWindow: 128000,
      maxOutputTokens: 16384,
      pricing: { inputPer1M: 0.5, outputPer1M: 1.5, cacheReadPer1M: 0.1, cacheWritePer1M: 0.2 },
      modalities: { text: true, vision: true, audio: false },
      tools: { toolCalling: true, structuredOutput: true, jsonMode: false },
      generation: { streaming: true, temperature: { min: 0, max: 2 }, reasoningEffort: ["low", "medium", "high"], systemPrompt: true },
      policy: { allowPlatformCredential: true, allowUserCredential: true, tags: ["production"] },
    };
    const result = PlatformModelCapabilitiesSchema.parse(input);
    expect(result.contextWindow).toBe(128000);
    expect(result.maxOutputTokens).toBe(16384);
    expect(result.generation.reasoningEffort).toEqual(["low", "medium", "high"]);
  });

  it("applies safe defaults for partial input", () => {
    const result = PlatformModelCapabilitiesSchema.parse({ contextWindow: 4096, maxOutputTokens: 1024, pricing: { inputPer1M: 0, outputPer1M: 0 } });
    expect(result.modalities.vision).toBe(false);
    expect(result.modalities.audio).toBe(false);
    expect(result.tools.toolCalling).toBe(false);
    expect(result.generation.streaming).toBe(true);
    expect(result.generation.reasoningEffort).toEqual([]);
    expect(result.policy.allowPlatformCredential).toBe(true);
  });

  it("rejects negative context window", () => {
    expect(() => PlatformModelCapabilitiesSchema.parse({ contextWindow: -1, maxOutputTokens: 100, pricing: { inputPer1M: 0, outputPer1M: 0 } })).toThrow();
  });

  it("rejects reasoningEffort values outside enum", () => {
    expect(() => PlatformModelCapabilitiesSchema.parse({ contextWindow: 100, maxOutputTokens: 100, pricing: { inputPer1M: 0, outputPer1M: 0 }, generation: { reasoningEffort: ["extreme"] } })).toThrow();
  });
});

describe("defaultPlatformModelCapabilities", () => {
  it("returns conservative defaults", () => {
    const defaults = defaultPlatformModelCapabilities();
    expect(defaults.contextWindow).toBe(0);
    expect(defaults.maxOutputTokens).toBe(0);
    expect(defaults.tools.toolCalling).toBe(false);
    expect(defaults.policy.allowPlatformCredential).toBe(true);
  });
});

describe("normalizePlatformModelCapabilities", () => {
  it("fills missing fields with defaults", () => {
    const result = normalizePlatformModelCapabilities({});
    expect(result.contextWindow).toBe(0);
    expect(result.maxOutputTokens).toBe(0);
    expect(result.modalities.vision).toBe(false);
    expect(result.generation.reasoningEffort).toEqual([]);
  });

  it("does not overwrite provided fields", () => {
    const result = normalizePlatformModelCapabilities({ contextWindow: 131072, maxOutputTokens: 16000, pricing: { inputPer1M: 1, outputPer1M: 2 } });
    expect(result.contextWindow).toBe(131072);
    expect(result.generation.streaming).toBe(true);
  });

  it("returns default for null/undefined", () => {
    const result = normalizePlatformModelCapabilities(null);
    expect(result.contextWindow).toBe(0);
  });
});

describe("assertSelectionAllowed", () => {
  const entry = normalizePlatformModelCapabilities({ contextWindow: 128000, maxOutputTokens: 16384, pricing: { inputPer1M: 1, outputPer1M: 2 }, generation: { temperature: { min: 0, max: 1.5 }, reasoningEffort: ["low", "medium"] }, tools: { toolCalling: true } });

  it("passes a valid selection", () => {
    expect(() => assertSelectionAllowed({ provider: "openai", model: "gpt-5", parameters: { temperature: 0.7, maxTokens: 4096, reasoningEffort: "medium" } }, entry, { allowPlatformCredential: true })).not.toThrow();
  });

  it("rejects temperature out of range", () => {
    expect(() => assertSelectionAllowed({ provider: "openai", model: "gpt-5", parameters: { temperature: 2.0 } }, entry, { allowPlatformCredential: true })).toThrow("parameter_out_of_range");
  });

  it("rejects maxTokens exceeding model limit", () => {
    expect(() => assertSelectionAllowed({ provider: "openai", model: "gpt-5", parameters: { maxTokens: 99999 } }, entry, { allowPlatformCredential: true })).toThrow("parameter_out_of_range");
  });

  it("rejects reasoningEffort not supported by model", () => {
    expect(() => assertSelectionAllowed({ provider: "openai", model: "gpt-5", parameters: { reasoningEffort: "high" } }, entry, { allowPlatformCredential: true })).toThrow("capability_unsupported");
  });

  it("rejects when policy disallows platform credential and no credentialId provided", () => {
    expect(() => assertSelectionAllowed({ provider: "openai", model: "gpt-5" }, entry, { allowPlatformCredential: false })).toThrow("credential_policy_violation");
  });

  it("rejects when policy disallows user credential and credentialId provided", () => {
    expect(() => assertSelectionAllowed({ provider: "openai", model: "gpt-5", credentialId: "some-uuid" }, entry, { allowPlatformCredential: true, allowUserCredential: false })).toThrow("credential_policy_violation");
  });

  it("passes platform path when platform credential allowed and no credentialId", () => {
    expect(() => assertSelectionAllowed({ provider: "openai", model: "gpt-5" }, entry, { allowPlatformCredential: true })).not.toThrow();
  });

  it("passes with no parameters provided", () => {
    expect(() => assertSelectionAllowed({ provider: "openai", model: "gpt-5" }, entry, { allowPlatformCredential: true })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/models/capabilities.test.ts --pool=threads
```

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/models/capabilities.ts
import { z } from "zod";

export const PlatformModelCapabilitiesSchema = z.object({
  contextWindow: z.number().int().nonnegative().default(0),
  maxOutputTokens: z.number().int().nonnegative().default(0),
  pricing: z.object({
    inputPer1M: z.number().min(0).default(0),
    outputPer1M: z.number().min(0).default(0),
    cacheReadPer1M: z.number().min(0).optional(),
    cacheWritePer1M: z.number().min(0).optional(),
  }).default({}),
  modalities: z.object({
    text: z.boolean().default(true),
    vision: z.boolean().default(false),
    audio: z.boolean().default(false),
  }).default({}),
  tools: z.object({
    toolCalling: z.boolean().default(false),
    structuredOutput: z.boolean().default(false),
    jsonMode: z.boolean().default(false),
  }).default({}),
  generation: z.object({
    streaming: z.boolean().default(true),
    temperature: z.object({ min: z.number().default(0), max: z.number().default(2) }).default({}),
    reasoningEffort: z.array(z.enum(["low", "medium", "high"])).default([]),
    systemPrompt: z.boolean().default(true),
  }).default({}),
  policy: z.object({
    allowPlatformCredential: z.boolean().default(true),
    allowUserCredential: z.boolean().default(true),
    tags: z.array(z.string()).default([]),
  }).default({}),
});

export type PlatformModelCapabilities = z.infer<typeof PlatformModelCapabilitiesSchema>;

export function defaultPlatformModelCapabilities(): PlatformModelCapabilities {
  return PlatformModelCapabilitiesSchema.parse({});
}

export function normalizePlatformModelCapabilities(input: unknown): PlatformModelCapabilities {
  if (!input || typeof input !== "object") return defaultPlatformModelCapabilities();
  return PlatformModelCapabilitiesSchema.parse(input);
}

export interface CatalogEntry {
  provider: string;
  model: string;
  status: "active" | "disabled";
  capabilities: PlatformModelCapabilities;
  priceKnown: boolean;
  credentialSource?: "environment" | "encrypted";
}

export interface SelectionInput {
  provider: string;
  model: string;
  credentialId?: string;
  parameters?: {
    temperature?: number;
    maxTokens?: number;
    reasoningEffort?: "low" | "medium" | "high";
  };
}

export interface SelectionPolicy {
  allowPlatformCredential: boolean;
  allowUserCredential?: boolean;
}

export function assertSelectionAllowed(
  selection: SelectionInput,
  catalogEntry: { capabilities: PlatformModelCapabilities },
  policy: SelectionPolicy,
): void {
  const caps = catalogEntry.capabilities;

  if (selection.credentialId && policy.allowUserCredential === false) {
    throw new Error("credential_policy_violation: user credentials not allowed for this model");
  }
  if (!selection.credentialId && !policy.allowPlatformCredential) {
    throw new Error("credential_policy_violation: platform credential not allowed for this model");
  }

  if (selection.parameters?.temperature !== undefined) {
    const t = selection.parameters.temperature;
    const { min, max } = caps.generation.temperature;
    if (t < min || t > max) throw new Error(`parameter_out_of_range: temperature ${t} not in [${min}, ${max}]`);
  }

  if (selection.parameters?.maxTokens !== undefined) {
    if (selection.parameters.maxTokens > caps.maxOutputTokens) {
      throw new Error(`parameter_out_of_range: maxTokens ${selection.parameters.maxTokens} exceeds model limit ${caps.maxOutputTokens}`);
    }
  }

  if (selection.parameters?.reasoningEffort !== undefined) {
    if (!caps.generation.reasoningEffort.includes(selection.parameters.reasoningEffort)) {
      throw new Error(`capability_unsupported: reasoningEffort ${selection.parameters.reasoningEffort} not supported`);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run src/models/capabilities.test.ts --pool=threads
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/models/capabilities.ts src/models/capabilities.test.ts
git commit -m "feat(models): add platform model capabilities schema and assertion guard"
```

---

### Task 2: Database Migration — Add capabilities Column

**Files:**
- Create: `drizzle/0017_<tag>.sql`
- Create: `drizzle/meta/0017_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/db/schema/providers.ts`

**Interfaces:**
- Consumes: `PlatformModelCapabilitiesSchema` from Task 1
- Produces: `platformModels.capabilities` column in Drizzle schema; `platform_models.capabilities` in PostgreSQL

- [ ] **Step 1: Add capabilities to Drizzle table definition**

```typescript
// src/db/schema/providers.ts — inside platformModels definition, add after line with metadata:

    capabilities: jsonb("capabilities").notNull().default({}),
```

- [ ] **Step 2: Generate migration with drizzle-kit**

```bash
pnpm drizzle-kit generate --name capabilities_column
```

This produces `drizzle/0017_<tag>.sql` and `drizzle/meta/0017_snapshot.json`. The journal is auto-updated.

- [ ] **Step 3: Add backfill logic to the generated migration**

Edit the generated SQL file to include a backfill after the ALTER TABLE:

```sql
ALTER TABLE "platform_models" ADD COLUMN "capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL;

-- Backfill: project pricing from existing columns, fill safe defaults
UPDATE "platform_models"
SET "capabilities" = jsonb_build_object(
  'contextWindow', 0,
  'maxOutputTokens', 0,
  'pricing', jsonb_build_object(
    'inputPer1M', CAST("input_price" AS float8),
    'outputPer1M', CAST("output_price" AS float8)
  ),
  'modalities', '{"text": true, "vision": false, "audio": false}'::jsonb,
  'tools', '{"toolCalling": false, "structuredOutput": false, "jsonMode": false}'::jsonb,
  'generation', '{"streaming": true, "temperature": {"min": 0, "max": 2}, "reasoningEffort": [], "systemPrompt": true}'::jsonb,
  'policy', '{"allowPlatformCredential": true, "allowUserCredential": true, "tags": []}'::jsonb
);
```

- [ ] **Step 4: Verify schema test picks up the column**

```bash
pnpm vitest run src/db/schema.test.ts --pool=threads -t 'platform_models'
```

The existing schema test should still pass (it checks table existence and column count/shape).

- [ ] **Step 5: Commit**

```bash
git add src/db/schema/providers.ts drizzle/
git commit -m "feat(db): add capabilities jsonb column to platform_models with backfill"
```

---

### Task 3: Admin API — Accept and Return Capabilities

**Files:**
- Modify: `src/web/admin/routes.ts`
- Modify: `src/web/admin/admin.test.ts`

**Interfaces:**
- Consumes: `normalizePlatformModelCapabilities` from Task 1, `platformModels.capabilities` from Task 2
- Produces: Admin `ModelInput` accepts optional `capabilities`; `GET` returns normalized capabilities; `publicModel` strips credentialReference but includes capabilities

- [ ] **Step 1: Extend Admin test to expect capabilities in create and list**

Add to `src/web/admin/admin.test.ts`:

```typescript
// inside describe("admin routes")

it("persists and returns normalized model capabilities", async () => {
  const { app, repository } = await server("admin");
  const created = { id: "m", provider: "openai", model: "gpt", status: "active", capabilities: { contextWindow: 128000, maxOutputTokens: 16384, pricing: { inputPer1M: 1, outputPer1M: 2 }, modalities: { text: true, vision: true, audio: false }, tools: { toolCalling: true, structuredOutput: false, jsonMode: false }, generation: { streaming: true, temperature: { min: 0, max: 2 }, reasoningEffort: ["low", "medium"], systemPrompt: true }, policy: { allowPlatformCredential: true, allowUserCredential: true, tags: [] } }, inputPrice: "1", outputPrice: "2", credentialReference: "env:OPENAI_API_KEY", metadata: {} };
  repository.createModel.mockResolvedValueOnce(created as never);
  repository.listModels.mockResolvedValueOnce([created] as never);

  const createResponse = await app.inject({
    method: "POST", url: "/api/admin/models",
    payload: { provider: "openai", model: "gpt", status: "active", inputPrice: 1, outputPrice: 2, credentialReference: "env:OPENAI_API_KEY", capabilities: { contextWindow: 128000, maxOutputTokens: 16384, generation: { reasoningEffort: ["low", "medium"] } } },
  });
  expect(createResponse.statusCode).toBe(201);
  expect(createResponse.json().model).toHaveProperty("capabilities");

  const listResponse = await app.inject({ method: "GET", url: "/api/admin/models" });
  expect(listResponse.json().models[0]).toHaveProperty("capabilities");
  expect(listResponse.json().models[0]).not.toHaveProperty("credentialReference");
  await app.close();
});

it("rejects capabilities with negative context window", async () => {
  const { app } = await server("admin");
  const response = await app.inject({
    method: "POST", url: "/api/admin/models",
    payload: { provider: "openai", model: "gpt", status: "active", inputPrice: 1, outputPrice: 2, credentialReference: "env:OPENAI_API_KEY", capabilities: { contextWindow: -1, maxOutputTokens: 100 } },
  });
  expect(response.statusCode).toBe(400);
  await app.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run src/web/admin/admin.test.ts --pool=threads
```
Expected: 2 new tests FAIL (capabilities field not accepted/returned).

- [ ] **Step 3: Modify Admin routes to accept/return capabilities**

In `src/web/admin/routes.ts`:

```typescript
// Add the CapabilitiesSchema inline (or import from Task 1)
import { normalizePlatformModelCapabilities } from "../../models/capabilities.js";

const CapabilitiesInput = z.record(z.unknown()).optional();
const ModelInput = z.object({
  provider: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(200),
  status: z.enum(["active", "disabled"]),
  inputPrice: z.number().finite().nonnegative(),
  outputPrice: z.number().finite().nonnegative(),
  credentialReference: CredentialReference,
  capabilities: CapabilitiesInput,
  metadata: z.record(z.unknown()).optional(),
}).strict();
```

In `DatabaseAdminRepository.createModel`:
```typescript
const normalizedCaps = normalizePlatformModelCapabilities(input.capabilities);
const [model] = await tx.insert(platformModels).values({
  ...input,
  capabilities: normalizedCaps,
  metadata,
  inputPrice: String(input.inputPrice),
  outputPrice: String(input.outputPrice),
}).returning();
```

In `DatabaseAdminRepository.updateModel`:
```typescript
// Accept capabilities in partial update, normalize if provided
const { capabilities: capsInput, ...rest } = input;
const values = {
  ...rest,
  ...(capsInput !== undefined ? { capabilities: normalizePlatformModelCapabilities(capsInput) } : {}),
  ...
};
```

In `publicModel`:
```typescript
function publicModel(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const { credentialReference: _ref, ...model } = value as Record<string, unknown>;
  return {
    ...model,
    credentialSource: /* existing logic */,
    capabilities: normalizePlatformModelCapabilities((value as Record<string, unknown>).capabilities),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run src/web/admin/admin.test.ts --pool=threads
```
Expected: all tests PASS, including the 2 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/web/admin/routes.ts src/web/admin/admin.test.ts
git commit -m "feat(admin): accept and return capabilities in platform model API"
```

---

### Task 4: Model Catalog and Gate A — Configuration-Time Validation

**Files:**
- Modify: `src/web/providers/modelConfig.ts`
- Modify: `src/web/providers/modelConfig.test.ts`
- Modify: `src/web/providers/repository.ts`

**Interfaces:**
- Consumes: `assertSelectionAllowed`, `normalizePlatformModelCapabilities` from Task 1
- Produces: `ModelCatalog` entries include `capabilities`; `validateModelSetInput` validates parameters against model capabilities

- [ ] **Step 1: Extend modelConfig tests for capability gating**

Add to `src/web/providers/modelConfig.test.ts`:

```typescript
// Add after existing tests, inside the same describe block

it("rejects parameters that exceed model capabilities", () => {
  const capsCatalog: ModelCatalog = {
    credentials: [],
    platformModels: [{ provider: "openai", model: "gpt-5", capabilities: { contextWindow: 100000, maxOutputTokens: 4096, pricing: { inputPer1M: 0, outputPer1M: 0 }, modalities: { text: true, vision: false, audio: false }, tools: { toolCalling: false, structuredOutput: false, jsonMode: false }, generation: { streaming: true, temperature: { min: 0, max: 1.5 }, reasoningEffort: ["low"], systemPrompt: true }, policy: { allowPlatformCredential: true, allowUserCredential: false, tags: [] } } }],
  };
  // maxTokens exceeds model limit
  expect(() => validateModelSetInput({
    name: "Bad params",
    agents: { writer: { provider: "openai", model: "gpt-5", parameters: { maxTokens: 99999 } } },
  }, capsCatalog)).toThrow("parameter_out_of_range");

  // reasoningEffort not supported
  expect(() => validateModelSetInput({
    name: "Bad reasoning",
    agents: { writer: { provider: "openai", model: "gpt-5", parameters: { reasoningEffort: "high" } } },
  }, capsCatalog)).toThrow("capability_unsupported");

  // temperature out of range
  expect(() => validateModelSetInput({
    name: "Bad temp",
    agents: { writer: { provider: "openai", model: "gpt-5", parameters: { temperature: 2.0 } } },
  }, capsCatalog)).toThrow("parameter_out_of_range");
});

it("accepts valid parameters within model capabilities", () => {
  const capsCatalog: ModelCatalog = {
    credentials: [],
    platformModels: [{ provider: "openai", model: "gpt-5", capabilities: { contextWindow: 100000, maxOutputTokens: 16384, pricing: { inputPer1M: 0, outputPer1M: 0 }, modalities: { text: true, vision: false, audio: false }, tools: { toolCalling: false, structuredOutput: false, jsonMode: false }, generation: { streaming: true, temperature: { min: 0, max: 2 }, reasoningEffort: ["low", "medium", "high"], systemPrompt: true }, policy: { allowPlatformCredential: true, allowUserCredential: true, tags: [] } } }],
  };
  expect(validateModelSetInput({
    name: "Valid params",
    agents: { writer: { provider: "openai", model: "gpt-5", parameters: { temperature: 0.4, maxTokens: 2048, reasoningEffort: "medium" } } },
  }, capsCatalog)).toMatchObject({ name: "Valid params" });
});
```

- [ ] **Step 2: Run tests to see failures**

```bash
pnpm vitest run src/web/providers/modelConfig.test.ts --pool=threads
```

- [ ] **Step 3: Implement Gate A in validateModelSetInput**

In `src/web/providers/modelConfig.ts`, update:

```typescript
import { assertSelectionAllowed, normalizePlatformModelCapabilities, type PlatformModelCapabilities } from "../../models/capabilities.js";

export interface ModelCatalog {
  credentials: Array<{ id: string; provider: string; label?: string }>;
  platformModels: Array<{ provider: string; model: string; capabilities: PlatformModelCapabilities }>;
}

export function validateModelSetInput(input: unknown, catalog: ModelCatalog): ModelSetInput {
  const parsed = ModelSetInputSchema.parse(input);
  for (const [role, selection] of Object.entries(parsed.agents)) {
    // Find catalog entry and validate
    const catalogEntry = catalog.platformModels.find(
      (m) => m.provider === selection.provider && m.model === selection.model
    );
    if (!catalogEntry) throw new Error("model_unavailable: provider/model not in catalog");

    // Credential validation (existing)
    if (selection.credentialId) {
      const credential = catalog.credentials.find(({ id }) => id === selection.credentialId);
      if (!credential || credential.provider !== selection.provider) throw new Error("Invalid credential reference");
    }

    // Gate A — capability validation
    assertSelectionAllowed(
      { provider: selection.provider, model: selection.model, credentialId: selection.credentialId, parameters: selection.parameters },
      catalogEntry,
      { allowPlatformCredential: catalogEntry.capabilities.policy.allowPlatformCredential, allowUserCredential: catalogEntry.capabilities.policy.allowUserCredential },
    );
  }
  return parsed;
}
```

Remove the old inline provider/model checking that `assertSelectionAllowed` supersedes.

- [ ] **Step 4: Update repository to include capabilities in catalog**

In `src/web/providers/repository.ts`, update `catalog`:

```typescript
import { normalizePlatformModelCapabilities } from "../../models/capabilities.js";

async catalog(auth: RequestAuth): Promise<ModelCatalog> {
  const [credentials, models] = await Promise.all([
    this.db.select({ id: providerCredentials.id, provider: providerCredentials.provider, label: providerCredentials.label }).from(providerCredentials).where(and(eq(providerCredentials.userId, auth.userId), eq(providerCredentials.status, "active"))),
    this.db.select({ provider: platformModels.provider, model: platformModels.model, capabilities: platformModels.capabilities, metadata: platformModels.metadata, inputPrice: platformModels.inputPrice, outputPrice: platformModels.outputPrice }).from(platformModels).where(eq(platformModels.status, "active")),
  ]);
  return {
    credentials,
    platformModels: models
      .filter((model) => hasKnownPlatformPrice(model.metadata, model.inputPrice, model.outputPrice))
      .map(({ provider, model, capabilities }) => ({
        provider,
        model,
        capabilities: normalizePlatformModelCapabilities(capabilities),
      })),
  };
}
```

Also update `create` and `revise` to snapshot capabilities into model-set `agents` records when needed (the capabilities of the selected models become the validation baseline at run-time).

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm vitest run src/web/providers/modelConfig.test.ts --pool=threads
```

- [ ] **Step 6: Commit**

```bash
git add src/web/providers/modelConfig.ts src/web/providers/modelConfig.test.ts src/web/providers/repository.ts
git commit -m "feat(providers): integrate capability gating into model-set validation and catalog"
```

---

### Task 5: Run Model Switch — Gate A for Live Model Switching

**Files:**
- Modify: `src/scheduler/repository.ts`
- Modify: `src/web/runs/routes.ts`
- Modify: `src/web/runs/routes.test.ts`

**Interfaces:**
- Consumes: capability catalog via `ModelConfigurationRepository`
- Produces: `validateModelSelection` uses capabilities; model-switch API returns 400 on capability violations

- [ ] **Step 1: Extend run routes test for capability rejection**

Add to `src/web/runs/routes.test.ts`:

```typescript
// New test inside the existing describe
it("rejects model switch with unsupported reasoningEffort", async () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const run = await startRun(userId);
  const response = await app.inject({
    method: "POST",
    url: `/api/projects/project-a/runs/${run.id}/model`,
    headers: { "x-user-id": userId },
    payload: { role: "writer", provider: "openai", model: "gpt-5", parameters: { reasoningEffort: "high" } },
  });
  expect(response.statusCode).toBe(400); // model configured without reasoningEffort support
});
```

- [ ] **Step 2: Verify the test fails**

```bash
TEST_DATABASE_URL=postgres://... pnpm vitest run src/web/runs/routes.test.ts --pool=threads
```
(Requires valid TEST_DATABASE_URL; adapt if needed.)

- [ ] **Step 3: Update validateModelSelection to use capabilities**

In `src/scheduler/repository.ts`, modify `validateModelSelection`:

```typescript
import { normalizePlatformModelCapabilities, assertSelectionAllowed } from "../../models/capabilities.js";

async validateModelSelection(auth: RequestAuth, selection: { provider: string; model: string; credentialId?: string; parameters?: { temperature?: number; maxTokens?: number; reasoningEffort?: "low" | "medium" | "high" } }): Promise<boolean> {
  const [model] = await this.db.select({
    capabilities: platformModels.capabilities,
    metadata: platformModels.metadata,
    inputPrice: platformModels.inputPrice,
    outputPrice: platformModels.outputPrice,
  }).from(platformModels).where(
    and(eq(platformModels.provider, selection.provider), eq(platformModels.model, selection.model), eq(platformModels.status, "active"))
  ).limit(1);

  if (!model || !hasKnownPlatformPrice(model.metadata, model.inputPrice, model.outputPrice)) return false;

  const caps = normalizePlatformModelCapabilities(model.capabilities);
  try {
    assertSelectionAllowed(selection, { capabilities: caps }, {
      allowPlatformCredential: caps.policy.allowPlatformCredential,
      allowUserCredential: caps.policy.allowUserCredential,
    });
  } catch {
    return false;
  }

  // Existing credential check
  if (selection.credentialId) {
    const [credential] = await this.db.select({ id: providerCredentials.id }).from(providerCredentials).where(
      and(eq(providerCredentials.id, selection.credentialId), eq(providerCredentials.userId, auth.userId), eq(providerCredentials.provider, selection.provider), eq(providerCredentials.status, "active"))
    ).limit(1);
    if (!credential) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
TEST_DATABASE_URL=postgres://... pnpm vitest run src/web/runs/routes.test.ts --pool=threads
```

- [ ] **Step 5: Commit**

```bash
git add src/scheduler/repository.ts src/web/runs/routes.test.ts
git commit -m "feat(runs): enforce capability gates on live model switching"
```

---

### Task 6: Worker/Host Gate B — Runtime Preflight

**Files:**
- Modify: `src/worker/configuration.ts`
- Modify: `src/worker/configuration.test.ts`
- Modify: `src/worker/runner.test.ts`

**Interfaces:**
- Consumes: `assertSelectionAllowed`, `normalizePlatformModelCapabilities` from Task 1
- Produces: `applyRunConfiguration` validates each agent's selection against current DB capabilities

- [ ] **Step 1: Extend configuration test for capability rejection**

Add to `src/worker/configuration.test.ts`:

```typescript
it("rejects run configuration when parameters exceed model capabilities", () => {
  expect(() => applyRunConfiguration(
    { provider: "openai", model: "default", providers: { openai: {} }, roles: {}, reflection: { enabled: false } },
    {
      configurationSnapshot: {
        modelSetId: "set-1", version: 2,
        agents: {
          writer: { provider: "openai", model: "gpt-5", parameters: { maxTokens: 999999, temperature: 5.0 } },
        },
        capabilities: { writer: { maxOutputTokens: 4096, generation: { temperature: { min: 0, max: 1.5 }, reasoningEffort: ["low"] } } },
      },
    },
  )).toThrow("parameter_out_of_range");
});

it("accepts run configuration with parameters within capability bounds", () => {
  const config = applyRunConfiguration(
    { provider: "openai", model: "default", providers: { openai: {} }, roles: {}, reflection: { enabled: false } },
    {
      configurationSnapshot: {
        modelSetId: "set-1", version: 2,
        agents: {
          writer: { provider: "openai", model: "gpt-5", parameters: { temperature: 0.4, maxTokens: 2048, reasoningEffort: "low" } },
        },
        capabilities: { writer: { maxOutputTokens: 16384, generation: { temperature: { min: 0, max: 2 }, reasoningEffort: ["low", "medium"] } } },
      },
    },
  );
  expect(config.roles?.writer).toMatchObject({ provider: "openai", model: "gpt-5", temperature: 0.4 });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
pnpm vitest run src/worker/configuration.test.ts --pool=threads
```

- [ ] **Step 3: Implement Gate B in applyRunConfiguration**

In `src/worker/configuration.ts`:

```typescript
import { assertSelectionAllowed } from "../models/capabilities.js";

export function applyRunConfiguration(base: Config, payload: unknown): Config {
  if (!payload || typeof payload !== "object") return base;
  const snapshot = (payload as Record<string, unknown>).configurationSnapshot;
  if (!snapshot || typeof snapshot !== "object") return base;
  const agents = (snapshot as Record<string, unknown>).agents;
  if (!agents || typeof agents !== "object" || Array.isArray(agents)) return base;

  const snapCaps = (snapshot as Record<string, unknown>).capabilities;
  const capabilities = snapCaps && typeof snapCaps === "object" ? snapCaps as Record<string, Record<string, unknown>> : {};

  const roles = { ...(base.roles ?? {}) };
  for (const [role, candidate] of Object.entries(agents)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const selection = candidate as Partial<SnapshotSelection>;
    if (typeof selection.provider !== "string" || typeof selection.model !== "string") continue;
    if (!base.providers?.[selection.provider]) throw new Error(`provider ${JSON.stringify(selection.provider)} is not configured for this worker`);

    // Gate B — runtime capability check
    const roleCaps = capabilities[role];
    if (roleCaps) {
      assertSelectionAllowed(
        { provider: selection.provider, model: selection.model, credentialId: selection.credentialId, parameters: selection.parameters },
        { capabilities: roleCaps as any },
        { allowPlatformCredential: true, allowUserCredential: true },
      );
    }

    roles[role] = {
      provider: selection.provider, model: selection.model,
      reasoning_effort: selection.parameters?.reasoningEffort,
      credential_id: selection.credentialId,
      temperature: selection.parameters?.temperature,
      max_tokens: selection.parameters?.maxTokens,
    };
  }
  return { ...base, roles };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run src/worker/configuration.test.ts --pool=threads
```

- [ ] **Step 5: Run existing regression tests**

```bash
pnpm vitest run src/worker/runner.test.ts --pool=threads
```

- [ ] **Step 6: Commit**

```bash
git add src/worker/configuration.ts src/worker/configuration.test.ts
git commit -m "feat(worker): add runtime capability preflight to run configuration"
```

---

### Task 7: Usage and Settings — Surface Capabilities

**Files:**
- Modify: `src/web/usage/routes.ts`
- Modify: `src/web/usage/usage.test.ts`

**Interfaces:**
- Consumes: `platformModels.capabilities` from DB query
- Produces: `platformModelAvailability` entries include `capabilities`; settings UI renders capability summary

- [ ] **Step 1: Extend usage test for capabilities in availability**

Add to `src/web/usage/usage.test.ts`:

```typescript
import { normalizePlatformModelCapabilities } from "../../models/capabilities.js";

it("includes capabilities in platform model availability", () => {
  const result = platformModelAvailability([
    { provider: "openai", model: "known", status: "active", metadata: {}, inputPrice: "1", outputPrice: "2", capabilities: { contextWindow: 128000, maxOutputTokens: 16384, generation: { temperature: { min: 0, max: 2 }, reasoningEffort: ["low", "medium"] }, tools: { toolCalling: true }, modalities: { text: true, vision: false, audio: false }, policy: { allowPlatformCredential: true, allowUserCredential: true, tags: [] } } },
  ]);
  expect(result[0]).toMatchObject({
    model: "openai/known", available: true, unknownPrice: false,
    capabilities: expect.objectContaining({ contextWindow: 128000, maxOutputTokens: 16384 }),
  });
});
```

- [ ] **Step 2: Verify failure, then update platformModelAvailability**

Add `capabilities` to the select and return in `platformModelAvailability`:

```typescript
// In usage routes: select capabilities from platformModels
this.db.select({
  provider: platformModels.provider,
  model: platformModels.model,
  status: platformModels.status,
  capabilities: platformModels.capabilities,
  metadata: platformModels.metadata,
  inputPrice: platformModels.inputPrice,
  outputPrice: platformModels.outputPrice,
}).from(platformModels)

// In platformModelAvailability function signature and return
export function platformModelAvailability(rows: Array<{ provider: string; model: string; status: "active" | "disabled"; capabilities: unknown; metadata: unknown; inputPrice?: unknown; outputPrice?: unknown }>) {
  return rows.filter((row) => row.status === "active").map((row) => {
    const unknownPrice = !hasKnownPlatformPrice(row.metadata, row.inputPrice ?? 0, row.outputPrice ?? 0);
    const caps = normalizePlatformModelCapabilities(row.capabilities);
    return {
      model: `${row.provider}/${row.model}`,
      available: !unknownPrice,
      unknownPrice,
      capabilities: caps,
      ...(unknownPrice ? { reason: "unknown_price" as const } : {}),
    };
  });
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm vitest run src/web/usage/usage.test.ts --pool=threads
```

- [ ] **Step 4: Commit**

```bash
git add src/web/usage/routes.ts src/web/usage/usage.test.ts
git commit -m "feat(usage): surface capabilities in platform model availability"
```

---

### Task 8: Frontend Type Trimming — Capabilities in Settings and Workbench Selectors

**Files:**
- Modify: `src/web/client/pages/settings.tsx`
- Modify: `src/web/client/pages/settings.test.tsx`
- Modify: `src/web/client/workbench/runSidebar.tsx`
- Modify: `src/web/client/workbench/workbench.test.tsx`

**Interfaces:**
- Consumes: `capabilities` from usage API response; `capabilities` from workbench projection
- Produces: Settings page shows capability summary per model; workbench model selector shows capability hints

- [ ] **Step 1: Update settings types and test**

Update `src/web/client/pages/settings.test.tsx` to include `capabilities` in mock response:

```typescript
const request = vi.fn(async (path: string) => path === "/api/usage/" ? {
  settings: { concurrencyLimit: 1, adminMaxConcurrency: 4, budgetUsd: null, balanceUsd: 5 },
  perAgent: [], perModel: [],
  platformModels: [
    { model: "openai/gpt-5", available: true, unknownPrice: false, capabilities: { contextWindow: 128000, maxOutputTokens: 16384, generation: { reasoningEffort: ["low", "medium"] } } },
    { model: "custom/unknown", available: false, unknownPrice: true, reason: "unknown_price", capabilities: { contextWindow: 0, maxOutputTokens: 0 } },
  ],
} : { credentials: [] });
```

Add `capabilities` to interface:
```typescript
interface UsageResponse {
  // ...existing fields...
  platformModels: Array<{
    model: string; available: boolean; unknownPrice: boolean; reason?: string;
    capabilities?: { contextWindow?: number; maxOutputTokens?: number; generation?: { reasoningEffort?: string[] } };
  }>;
}
```

Update settings JSX to show a capability summary row for each model:
```typescript
// Inside the platform models section map
{model.capabilities && (
  <small>
    上下文 {model.capabilities.contextWindow?.toLocaleString() ?? "?"} · 最大输出 {model.capabilities.maxOutputTokens?.toLocaleString() ?? "?"}
    {model.capabilities.generation?.reasoningEffort?.length ? ` · 推理 ${model.capabilities.generation.reasoningEffort.join(" / ")}` : ""}
  </small>
)}
```

- [ ] **Step 2: Verify settings tests**

```bash
pnpm vitest run src/web/client/pages/settings.test.tsx --pool=threads
```

- [ ] **Step 3: Add capability hints to workbench model selector**

In `src/web/client/workbench/runSidebar.tsx`, the modelConfiguration `providers` now carry capabilities from the projection (Task 4 already updated repository). Add a `<small>` hint after the model select:

```typescript
const selectedModel = props.modelConfiguration?.providers
  .find(({ provider }) => provider === selectedProvider)
  ?.models.find(({ model }) => model === selectedModelValue); // read from form

// After the model <select>, add:
{selectedModel?.capabilities && (
  <small className="model-capability-hint">
    {selectedModel.capabilities.contextWindow?.toLocaleString()} 上下文 · 最高 {selectedModel.capabilities.maxOutputTokens?.toLocaleString()} tokens
  </small>
)}
```

- [ ] **Step 4: Update workbench test to expect capability hints**

In `src/web/client/workbench/workbench.test.tsx`, find the model rendering test and verify that when `modelConfiguration.providers` includes capabilities entries, the `small.model-capability-hint` is present.

- [ ] **Step 5: Run workbench tests**

```bash
pnpm vitest run src/web/client/workbench/workbench.test.tsx --pool=threads
```

- [ ] **Step 6: Commit**

```bash
git add src/web/client/pages/settings.tsx src/web/client/pages/settings.test.tsx src/web/client/workbench/runSidebar.tsx src/web/client/workbench/workbench.test.tsx
git commit -m "feat(webui): surface model capabilities in settings and model selector"
```

---

### Task 9: Full Regression Gate

**Files:** (none new; verify existing)

- [ ] **Step 1: Run unit suite**

```bash
pnpm vitest run --pool=threads --maxWorkers=1
```
Expected: 52+ tests PASS (plus new ones from Tasks 1-8).

- [ ] **Step 2: Run responsive Playwright**

```bash
TEST_DATABASE_URL=postgres://invalid pnpm exec playwright test --project=responsive
```
Expected: 16/16 PASS.

- [ ] **Step 3: Typecheck and build**

```bash
pnpm typecheck && pnpm build
```
Expected: both succeed.

- [ ] **Step 4: Git diff check**

```bash
git diff --check
```
Expected: clean.

- [ ] **Step 5: Update progress and commit**

Update `.superpowers/sdd/progress.md` with capabilities catalog completion status.

```bash
git add .superpowers/sdd/progress.md
git commit -m "docs(sdd): record platform model capabilities catalog completion"
```

---

### Task 10: Push

- [ ] **Step 1: Push to remote**

```bash
git push origin 260715-feat-multi-user-webui
```
