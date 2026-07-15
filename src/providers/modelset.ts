import type { LanguageModel } from "ai";
import { ConfigSchema, type Config, type ResolvedConfig } from "../config/schemas.js";
type LanguageModelInstance = Exclude<LanguageModel, string>;
import { createProvider } from "./adapter.js";
import { failoverModel, type FailoverReporter, type ModelTarget } from "./failover.js";

export interface ModelSelectionOptions { credentialId?: string; temperature?: number; maxTokens?: number }
export type ModelFactory = (provider: string, model: string, options?: ModelSelectionOptions) => LanguageModelInstance;

export class ModelSet {
  private defaultTarget: ModelTarget;
  private readonly roles = new Map<string, ModelTarget>();
  private readonly fallbacks = new Map<string, ModelTarget[]>();
  private readonly parameters = new Map<string, ModelSelectionOptions>();
  private readonly config: ResolvedConfig;
  private readonly factory: ModelFactory;
  private readonly reviewerTarget?: ModelTarget;
  private reviewerFallbacks: ModelTarget[] = [];

  constructor(config: Config, factory?: ModelFactory) {
    this.config = ConfigSchema.parse(config);
    this.factory = factory ?? ((provider, model) => createProvider(provider, this.config.providers[provider] ?? {}, model));
    this.defaultTarget = this.target(this.config.provider, this.config.model);
    if (this.config.reflection.reviewer_model) {
      const separator = this.config.reflection.reviewer_model.indexOf("/");
      const provider = separator > 0 ? this.config.reflection.reviewer_model.slice(0, separator) : this.config.provider;
      const model = separator > 0 ? this.config.reflection.reviewer_model.slice(separator + 1) : this.config.reflection.reviewer_model;
      this.reviewerTarget = this.target(provider, model);
    }
    for (const [role, roleConfig] of Object.entries(this.config.roles)) {
      const options = { ...(roleConfig.credential_id ? { credentialId: roleConfig.credential_id } : {}), ...(roleConfig.temperature === undefined ? {} : { temperature: roleConfig.temperature }), ...(roleConfig.max_tokens === undefined ? {} : { maxTokens: roleConfig.max_tokens }) };
      this.parameters.set(role, options);
      this.roles.set(role, this.target(roleConfig.provider, roleConfig.model, options));
      this.fallbacks.set(role, (roleConfig.fallbacks ?? []).map(ref => this.target(ref.provider, ref.model)));
      if (role === "reviewer") this.reviewerFallbacks = (roleConfig.fallbacks ?? []).map(ref => this.target(ref.provider, ref.model));
    }
  }

  private target(provider: string, model: string, options?: ModelSelectionOptions): ModelTarget { return { provider, model, instance: options && Object.keys(options).length ? this.factory(provider, model, options) : this.factory(provider, model) }; }
  forRole(role: string): LanguageModelInstance { return (this.roles.get(role) ?? this.defaultTarget).instance; }
  forReviewer(report?: FailoverReporter): LanguageModelInstance {
    const primary = this.roles.get("reviewer") ?? this.reviewerTarget ?? this.defaultTarget;
    return this.reviewerFallbacks.length ? failoverModel("reviewer", primary, this.reviewerFallbacks, report) : primary.instance;
  }
  forReviewerWithHotSwap(report?: FailoverReporter): LanguageModelInstance {
    return this.dynamic(() => {
      const primary = this.roles.get("reviewer") ?? this.reviewerTarget ?? this.defaultTarget;
      return this.reviewerFallbacks.length ? failoverModel("reviewer", primary, this.reviewerFallbacks, report) : primary.instance;
    });
  }
  forRoleWithFailover(role: string, report?: FailoverReporter): LanguageModelInstance {
    return this.dynamic(() => {
      const primary = this.roles.get(role);
      const fallbacks = this.fallbacks.get(role) ?? [];
      return primary && fallbacks.length ? failoverModel(role, primary, fallbacks, report) : (primary ?? this.defaultTarget).instance;
    });
  }
  async swap(role: string, provider: string, model: string, options: ModelSelectionOptions = {}): Promise<void> {
    if (!this.config.providers[provider]) throw new Error(`provider ${JSON.stringify(provider)} is not configured`);
    const target = this.target(provider, model, options);
    if (!role || role === "default") this.defaultTarget = target;
    else { this.roles.set(role, target); this.parameters.set(role, options); }
  }
  currentParameters(role: string): ModelSelectionOptions { return { ...(this.parameters.get(role) ?? {}) }; }
  currentSelection(role: string): { provider: string; model: string; explicit: boolean } {
    if (!role || role === "default") return { provider: this.defaultTarget.provider, model: this.defaultTarget.model, explicit: true };
    const target = this.roles.get(role);
    return target ? { provider: target.provider, model: target.model, explicit: true } : { provider: this.defaultTarget.provider, model: this.defaultTarget.model, explicit: false };
  }
  private dynamic(resolve: () => LanguageModelInstance): LanguageModelInstance {
    return new Proxy({} as LanguageModelInstance, {
      get(_target, property) {
        const value = Reflect.get(resolve() as object, property);
        return typeof value === "function" ? value.bind(resolve()) : value;
      },
    });
  }
}

export function createModelSet(config: Config, factory?: ModelFactory): ModelSet { return new ModelSet(config, factory); }
