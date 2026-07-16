import { createHash, randomUUID } from "node:crypto";
import type { LanguageModel } from "ai";
import type { DatabaseQuotaLedger } from "./ledger.js";

type Model = Exclude<LanguageModel, string>;

export function quotaGuardedModel(input: { provider: string; modelName: string; userId: string; projectId: string; runId: string; agent: string; inputPrice?: number | null; outputPrice?: number | null; resolvePricing?: () => Promise<{ inputPrice: number; outputPrice: number } | null>; ledger: DatabaseQuotaLedger; model: Model }): Model {
  const invoke = async (method: "doGenerate" | "doStream", options: unknown) => {
    const modelCallId = callId(input, options);
    const pricing = input.resolvePricing ? await input.resolvePricing() : input.inputPrice === undefined || input.outputPrice === undefined ? null : { inputPrice: input.inputPrice, outputPrice: input.outputPrice };
    const estimatedCostUsd = estimateCost(options, pricing?.inputPrice ?? null, pricing?.outputPrice ?? null);
    const reservation = await input.ledger.reserve({ userId: input.userId, projectId: input.projectId, runId: input.runId, modelCallId, estimatedCostUsd, model: `${input.provider}/${input.modelName}` });
    try {
      const operation = (input.model as unknown as Record<string, (value: unknown) => Promise<unknown>>)[method];
      if (!operation) throw new Error(`provider model does not implement ${method}`);
      const result = await operation.call(input.model, options) as Record<string, unknown>;
      if (method === "doStream") return wrapStreamResult(result, async (usage) => input.ledger.settle(settleInput(input, pricing, reservation.id, modelCallId, usage)));
      await input.ledger.settle(settleInput(input, pricing, reservation.id, modelCallId, usageFrom(result)));
      return result;
    } catch (error) {
      await input.ledger.release({ reservationId: reservation.id, userId: input.userId, projectId: input.projectId, runId: input.runId, modelCallId, model: `${input.provider}/${input.modelName}` });
      throw error;
    }
  };
  return { ...(input.model as unknown as Record<string, unknown>), doGenerate: (options: unknown) => invoke("doGenerate", options), doStream: (options: unknown) => invoke("doStream", options) } as unknown as Model;
}

function callId(input: { provider: string; modelName: string; agent: string }, options: unknown): string {
  if (options && typeof options === "object" && "modelCallId" in options && typeof options.modelCallId === "string") return options.modelCallId;
  try { return createHash("sha256").update(`${input.agent}\0${input.provider}\0${input.modelName}\0${JSON.stringify(options)}`).digest("hex"); } catch { return randomUUID(); }
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

function settleInput(input: Parameters<typeof quotaGuardedModel>[0], pricing: { inputPrice: number | null; outputPrice: number | null } | null, reservationId: string, modelCallId: string, usage: Record<string, unknown>) {
  const inputTokens = finite(usage.inputTokens), outputTokens = finite(usage.outputTokens);
  const actualCostUsd = !pricing || pricing.inputPrice === null || pricing.outputPrice === null ? 0 : (inputTokens * pricing.inputPrice + outputTokens * pricing.outputPrice) / 1_000_000;
  return { reservationId, userId: input.userId, projectId: input.projectId, runId: input.runId, modelCallId, actualCostUsd, usageId: modelCallId, usage: { ...usage, agent: input.agent }, model: `${input.provider}/${input.modelName}` };
}

function finite(value: unknown): number { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0; }

function wrapStreamResult(result: Record<string, unknown>, settle: (usage: Record<string, unknown>) => Promise<unknown>) {
  const stream = result.stream;
  if (!(stream instanceof ReadableStream)) return result;
  const transformed = stream.pipeThrough(new TransformStream({
    async transform(chunk, controller) {
      const value = chunk as { type?: string; usage?: Record<string, unknown> };
      if (value?.type === "finish") await settle(value.usage ?? {});
      controller.enqueue(chunk);
    },
  }));
  return { ...result, stream: transformed };
}
