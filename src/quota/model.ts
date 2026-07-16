import type { LanguageModel } from "ai";
import type { DatabaseQuotaLedger } from "./ledger.js";

type Model = Exclude<LanguageModel, string>;

export function quotaGuardedModel(input: { provider: string; modelName: string; userId: string; projectId: string; runId: string; taskId: string; leaseVersion: number; agent: string; credentialSource?: string; inputPrice?: number | null; outputPrice?: number | null; resolvePricing?: () => Promise<{ inputPrice: number; outputPrice: number; priceSource?: string; credentialSource?: string } | null>; ledger: DatabaseQuotaLedger; model: Model; heartbeatMs?: number; settlementRetry?: { attempts: number; baseDelayMs: number } }): Model {
  const invoke = async (method: "doGenerate" | "doStream", options: unknown) => {
    const modelCallId = invocationId(options);
    const pricing = input.resolvePricing ? await input.resolvePricing() : input.inputPrice === undefined || input.outputPrice === undefined ? null : { inputPrice: input.inputPrice, outputPrice: input.outputPrice };
    const estimatedCostUsd = estimateCost(options, pricing?.inputPrice ?? null, pricing?.outputPrice ?? null);
    const reservation = await input.ledger.reserve({ userId: input.userId, projectId: input.projectId, runId: input.runId, taskId: input.taskId, leaseVersion: input.leaseVersion, modelCallId, estimatedCostUsd, model: `${input.provider}/${input.modelName}` });
    const stopHeartbeat = heartbeat(input, reservation.id);
    const startedAt = Date.now();
    let providerCompleted = false;
    try {
      const operation = (input.model as unknown as Record<string, (value: unknown) => Promise<unknown>>)[method];
      if (!operation) throw new Error(`provider model does not implement ${method}`);
      const result = await operation.call(input.model, options) as Record<string, unknown>;
      providerCompleted = true;
      if (method === "doStream") { stopHeartbeat(); return wrapStreamResult(result, async (usage) => persistSettlement(input, settleInput(input, pricing, reservation.id, modelCallId, usage, Date.now() - startedAt)), async () => input.ledger.releaseDurably(releaseInput(input, reservation.id, modelCallId)), () => input.ledger.heartbeat(reservation.id, input.taskId, input.leaseVersion)); }
      await persistSettlement(input, settleInput(input, pricing, reservation.id, modelCallId, usageFrom(result), Date.now() - startedAt));
      stopHeartbeat();
      return result;
    } catch (error) {
      stopHeartbeat();
      if (!providerCompleted) await input.ledger.releaseDurably(releaseInput(input, reservation.id, modelCallId));
      throw error;
    }
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

async function persistSettlement(input: Parameters<typeof quotaGuardedModel>[0], settlement: ReturnType<typeof settleInput>): Promise<void> {
  const retry = input.settlementRetry ?? { attempts: 3, baseDelayMs: 50 };
  let lastError: unknown;
  for (let attempt = 0; attempt < retry.attempts; attempt++) {
    try { await input.ledger.settleDurably(settlement); return; } catch (error) { lastError = error; if (attempt + 1 < retry.attempts && retry.baseDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retry.baseDelayMs * 2 ** attempt)); }
  }
  await input.ledger.persistEstimateFallback({ ...settlement, needsReconciliation: true, error: lastError instanceof Error ? lastError.message : String(lastError) });
  throw lastError;
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

function wrapStreamResult(result: Record<string, unknown>, settle: (usage: Record<string, unknown>) => Promise<unknown>, release: () => Promise<unknown>, touch: () => Promise<unknown>) {
  const stream = result.stream;
  if (!(stream instanceof ReadableStream)) { void release(); return result; }
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
        if (value?.type === "finish") await finish(value.usage ?? {});
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
