import type { LanguageModel } from "ai";
import type { DatabaseQuotaLedger } from "./ledger.js";

type Model = Exclude<LanguageModel, string>;

export function quotaGuardedModel(input: { provider: string; modelName: string; userId: string; projectId: string; runId: string; taskId: string; leaseVersion: number; agent: string; credentialSource?: string; inputPrice?: number | null; outputPrice?: number | null; resolvePricing?: () => Promise<{ inputPrice: number; outputPrice: number; priceSource?: string; credentialSource?: string } | null>; ledger: DatabaseQuotaLedger; model: Model; heartbeatMs?: number; settlementRetry?: { baseDelayMs: number; maxDelayMs?: number }; ambiguousErrorPolicy?: "estimate" | "release" }): Model {
  const invoke = async (method: "doGenerate" | "doStream", options: unknown) => {
    const modelCallId = invocationId(options);
    const pricing = input.resolvePricing ? await input.resolvePricing() : input.inputPrice === undefined || input.outputPrice === undefined ? null : { inputPrice: input.inputPrice, outputPrice: input.outputPrice };
    const estimatedCostUsd = estimateCost(options, pricing?.inputPrice ?? null, pricing?.outputPrice ?? null);
    const reservation = await input.ledger.reserve({ userId: input.userId, projectId: input.projectId, runId: input.runId, taskId: input.taskId, leaseVersion: input.leaseVersion, modelCallId, estimatedCostUsd, model: `${input.provider}/${input.modelName}` });
    let prepared: PreparedProviderCall;
    try { prepared = await prepareProvider(input.model, method, options); }
    catch (error) { await input.ledger.releaseDurably({ ...releaseInput(input, reservation.id, modelCallId), reason: "provider_preflight_failed", errorCategory: "local_preflight", error: errorMessage(error) }); throw error; }
    try {
      await input.ledger.markProviderStarted(reservation.id, input.taskId, input.leaseVersion);
      const stopHeartbeat = heartbeat(input, reservation.id);
      const startedAt = Date.now();
      let providerCompleted = false;
      try {
        const result = await prepared.dispatch() as Record<string, unknown>;
        providerCompleted = true;
        if (method === "doStream") { stopHeartbeat(); return await wrapStreamResult(result, async (usage) => persistSettlement(input, settleInput(input, pricing, reservation.id, modelCallId, usage, Date.now() - startedAt), abortSignal(options)), async () => input.ledger.settleInterrupted({ ...releaseInput(input, reservation.id, modelCallId), reason: "provider_stream_missing_usage", errorCategory: "missing_usage", error: "provider stream ended without usage" }), () => input.ledger.heartbeat(reservation.id, input.taskId, input.leaseVersion)); }
        const usage = usageFrom(result);
        if (!hasBillableUsage(usage)) await input.ledger.settleInterrupted({ ...releaseInput(input, reservation.id, modelCallId), reason: "provider_result_missing_usage", errorCategory: "missing_usage", error: "provider result omitted usage" });
        else await persistSettlement(input, settleInput(input, pricing, reservation.id, modelCallId, usage, Date.now() - startedAt), abortSignal(options));
        stopHeartbeat();
        return result;
      } catch (error) {
        stopHeartbeat();
        if (!providerCompleted) {
          const outcome = classifyProviderError(error, input.ambiguousErrorPolicy ?? "estimate");
          const terminal = { ...releaseInput(input, reservation.id, modelCallId), reason: "provider_rejected_or_failed", errorCategory: outcome.category, error: errorMessage(error) };
          if (outcome.billing === "release") await input.ledger.releaseDurably(terminal);
          else await input.ledger.settleInterrupted(terminal);
        }
        throw error;
      }
    } finally { prepared.dispose(); }
  };
  return { ...(input.model as unknown as Record<string, unknown>), doGenerate: (options: unknown) => invoke("doGenerate", options), doStream: (options: unknown) => invoke("doStream", options) } as unknown as Model;
}

function invocationId(options: unknown): string {
  const providerOptions = options && typeof options === "object" && "providerOptions" in options ? options.providerOptions : undefined;
  const synchronicle = providerOptions && typeof providerOptions === "object" && "synchronicle" in providerOptions ? providerOptions.synchronicle : undefined;
  const value = synchronicle && typeof synchronicle === "object" && "invocationId" in synchronicle ? synchronicle.invocationId : undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error("durable invocation ID is required for platform model calls");
  return value;
}

async function persistSettlement(input: Parameters<typeof quotaGuardedModel>[0], settlement: ReturnType<typeof settleInput>, signal?: AbortSignal): Promise<void> {
  const retry = input.settlementRetry ?? { baseDelayMs: 50, maxDelayMs: 5_000 };
  let attempt = 0;
  for (;;) {
    signal?.throwIfAborted();
    try { await input.ledger.settleDurably(settlement); return; } catch { await abortableDelay(Math.min(retry.maxDelayMs ?? 5_000, retry.baseDelayMs * 2 ** Math.min(attempt++, 8)), signal); }
  }
}

function estimateCost(options: unknown, inputPrice: number | null, outputPrice: number | null): number | null {
  if (inputPrice === null || outputPrice === null) return null;
  const record = options && typeof options === "object" ? options as Record<string, unknown> : {};
  const inputTokens = Math.ceil(JSON.stringify(record.prompt ?? record.messages ?? "").length / 4);
  const outputTokens = typeof record.maxOutputTokens === "number" ? Math.max(0, record.maxOutputTokens) : 4096;
  return (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000;
}

function usageFrom(result: Record<string, unknown>): Record<string, unknown> {
  return result.usage && typeof result.usage === "object" ? result.usage as Record<string, unknown> : {};
}

function hasBillableUsage(usage: Record<string, unknown>): boolean { return finiteUsage(usage.inputTokens) || finiteUsage(usage.outputTokens); }
function finiteUsage(value: unknown): boolean { return typeof value === "number" && Number.isFinite(value) && value >= 0; }

interface PreparedProviderCall { dispatch(): Promise<unknown>; dispose(): void }

async function prepareProvider(model: Model, method: "doGenerate" | "doStream", options: unknown): Promise<PreparedProviderCall> {
  const record = model as unknown as Record<string, unknown>;
  if (typeof record.prepare === "function") return (record.prepare as (method: "doGenerate" | "doStream", options: unknown) => Promise<PreparedProviderCall>)(method, options);
  const operation = record[method];
  if (typeof operation !== "function") throw new Error(`provider model does not implement ${method}`);
  return { dispatch: () => (operation as (options: unknown) => Promise<unknown>).call(model, options), dispose() {} };
}

function classifyProviderError(error: unknown, ambiguous: "estimate" | "release"): { billing: "estimate" | "release"; category: string } {
  const value = error as { status?: unknown; statusCode?: unknown; code?: unknown; usage?: unknown };
  const status = Number(value?.status ?? value?.statusCode);
  if (value?.usage && typeof value.usage === "object" && hasBillableUsage(value.usage as Record<string, unknown>)) return { billing: "estimate", category: "usage_reported" };
  if (status === 401 || status === 403) return { billing: "release", category: "authentication" };
  if (status === 400 || status === 404) return { billing: "release", category: "validation" };
  if (status === 429) return { billing: "release", category: "rate_limit" };
  if (status === 408 || status >= 500 || ["ETIMEDOUT", "ECONNRESET", "ECONNABORTED"].includes(String(value?.code))) return { billing: "estimate", category: "provider_unknown" };
  return { billing: ambiguous, category: "provider_unknown" };
}

function abortSignal(options: unknown): AbortSignal | undefined { const value = options && typeof options === "object" ? (options as Record<string, unknown>).abortSignal : undefined; return value && typeof value === "object" && "aborted" in value ? value as AbortSignal : undefined; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> { if (ms <= 0) { signal?.throwIfAborted(); return Promise.resolve(); } return new Promise((resolve, reject) => { const timer = setTimeout(done, ms); const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason ?? new DOMException("The operation was aborted", "AbortError")); }; function done() { signal?.removeEventListener("abort", abort); resolve(); } signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort(); }); }

function settleInput(input: Parameters<typeof quotaGuardedModel>[0], pricing: { inputPrice: number | null; outputPrice: number | null; priceSource?: string; credentialSource?: string } | null, reservationId: string, modelCallId: string, usage: Record<string, unknown>, latencyMs: number) {
  const inputTokens = finite(usage.inputTokens), outputTokens = finite(usage.outputTokens);
  const actualCostUsd = !pricing || pricing.inputPrice === null || pricing.outputPrice === null ? 0 : (inputTokens * pricing.inputPrice + outputTokens * pricing.outputPrice) / 1_000_000;
  return { reservationId, userId: input.userId, projectId: input.projectId, runId: input.runId, taskId: input.taskId, leaseVersion: input.leaseVersion, modelCallId, actualCostUsd, usageId: modelCallId, usage: { ...usage, agent: input.agent }, model: `${input.provider}/${input.modelName}`, credentialSource: pricing?.credentialSource ?? input.credentialSource ?? "platform", priceSource: pricing?.priceSource ?? (pricing ? "platform" : "unknown"), latencyMs };
}

function finite(value: unknown): number { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0; }

function releaseInput(input: Parameters<typeof quotaGuardedModel>[0], reservationId: string, modelCallId: string) { return { reservationId, userId: input.userId, projectId: input.projectId, runId: input.runId, taskId: input.taskId, leaseVersion: input.leaseVersion, modelCallId, model: `${input.provider}/${input.modelName}` }; }

function heartbeat(input: Parameters<typeof quotaGuardedModel>[0], reservationId: string) {
  const timer = setInterval(() => { void input.ledger.heartbeat(reservationId, input.taskId, input.leaseVersion); }, input.heartbeatMs ?? 10_000);
  timer.unref?.();
  return () => clearInterval(timer);
}

async function wrapStreamResult(result: Record<string, unknown>, settle: (usage: Record<string, unknown>) => Promise<unknown>, release: () => Promise<unknown>, touch: () => Promise<unknown>) {
  const stream = result.stream;
  if (!(stream instanceof ReadableStream)) { await release(); throw new Error("Provider stream contract requires a ReadableStream"); }
  const reader = stream.getReader();
  let terminal = false;
  const finish = async (usage?: Record<string, unknown>) => { if (terminal) return; terminal = true; if (usage) await settle(usage); else await release(); };
  const transformed = new ReadableStream({
    async pull(controller) {
      try {
        await touch();
        const next = await reader.read();
        if (next.done) { await finish(); controller.close(); return; }
        const value = next.value as { type?: string; usage?: Record<string, unknown> };
        if (value?.type === "finish") await finish(value.usage && hasBillableUsage(value.usage) ? value.usage : undefined);
        controller.enqueue(next.value);
      } catch (error) {
        await finish();
        controller.error(error);
      }
    },
    async cancel(reason) { try { await reader.cancel(reason); } finally { await finish(); } },
  });
  return { ...result, stream: transformed };
}
