import type { LanguageModel } from "ai";
type LanguageModelInstance = Exclude<LanguageModel, string>;

export interface FailoverEvent { role: string; reason: string; fromProvider: string; fromModel: string; toProvider: string; toModel: string; error: unknown }
export type FailoverReporter = (event: FailoverEvent) => void;
export interface ModelTarget { provider: string; model: string; instance: LanguageModelInstance }
export interface ActualModelIdentity { provider: string; model: string }
const actualModelIdentity = Symbol("synchronicle.actualModelIdentity");

export function usageModelIdentity(value: unknown): ActualModelIdentity | undefined {
  return value && typeof value === "object" ? (value as { [actualModelIdentity]?: ActualModelIdentity })[actualModelIdentity] : undefined;
}

function attachIdentity<T>(result: T, target: ModelTarget): T {
  if (!result || typeof result !== "object") return result;
  const identity = { provider: target.provider, model: target.model };
  const source = result as { usage?: unknown; stream?: ReadableStream<unknown> };
  if (source.usage && typeof source.usage === "object") Object.defineProperty(source.usage, actualModelIdentity, { value: identity, enumerable: true });
  if (!source.stream) return result;
  const stream = source.stream.pipeThrough(new TransformStream({ transform(chunk, controller) { if (chunk && typeof chunk === "object" && "usage" in chunk) { const usage = (chunk as { usage?: unknown }).usage; if (usage && typeof usage === "object") Object.defineProperty(usage, actualModelIdentity, { value: identity, enumerable: true }); } controller.enqueue(chunk); } }));
  return { ...result, stream };
}

function reason(error: unknown): string | undefined {
  if (error instanceof DOMException && error.name === "AbortError") return undefined;
  const value = error as { statusCode?: number; status?: number; code?: string };
  const status = value?.statusCode ?? value?.status;
  if (status === 429) return "rate_limit";
  if (status === 408 || value?.code === "ETIMEDOUT") return "timeout";
  if (typeof status === "number" && status >= 500) return "network";
  return undefined;
}

export function failoverModel(role: string, primary: ModelTarget, fallbacks: ModelTarget[], report?: FailoverReporter): LanguageModelInstance {
  const attempt = async <T>(method: "doGenerate" | "doStream", options: never): Promise<T> => {
    try { return attachIdentity(await primary.instance[method](options) as T, primary); }
    catch (error) {
      const why = reason(error);
      const next = fallbacks.find(target => target.provider !== primary.provider || target.model !== primary.model);
      if (!why || !next) throw error;
      report?.({ role, reason: why, fromProvider: primary.provider, fromModel: primary.model, toProvider: next.provider, toModel: next.model, error });
      return attachIdentity(await next.instance[method](options) as T, next);
    }
  };
  return {
    specificationVersion: "v2",
    provider: primary.instance.provider,
    modelId: primary.instance.modelId,
    supportedUrls: primary.instance.supportedUrls,
    doGenerate: options => attempt("doGenerate", options as never),
    doStream: options => attempt("doStream", options as never),
  };
}
