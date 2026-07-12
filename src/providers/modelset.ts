import type { LanguageModel } from "ai";
import type { Config } from "../config/schemas.js";
type LanguageModelInstance = Exclude<LanguageModel, string>;
import { createProvider } from "./adapter.js";
import { failoverModel, type FailoverReporter, type ModelTarget } from "./failover.js";

export type ModelFactory = (provider: string, model: string) => LanguageModelInstance;

export class ModelSet {
  private defaultTarget: ModelTarget;
  private readonly roles = new Map<string, ModelTarget>();
  private readonly fallbacks = new Map<string, ModelTarget[]>();

  constructor(private readonly config: Config, private readonly factory: ModelFactory = (provider, model) => createProvider(provider, config.providers[provider] ?? {}, model)) {
    this.defaultTarget = this.target(config.provider, config.model);
    for (const [role, roleConfig] of Object.entries(config.roles)) {
      this.roles.set(role, this.target(roleConfig.provider, roleConfig.model));
      this.fallbacks.set(role, (roleConfig.fallbacks ?? []).map(ref => this.target(ref.provider, ref.model)));
    }
  }

  private target(provider: string, model: string): ModelTarget { return { provider, model, instance: this.factory(provider, model) }; }
  forRole(role: string): LanguageModelInstance { return (this.roles.get(role) ?? this.defaultTarget).instance; }
  forRoleWithFailover(role: string, report?: FailoverReporter): LanguageModelInstance {
    const primary = this.roles.get(role);
    const fallbacks = this.fallbacks.get(role) ?? [];
    return primary && fallbacks.length ? failoverModel(role, primary, fallbacks, report) : (primary ?? this.defaultTarget).instance;
  }
  async swap(role: string, provider: string, model: string): Promise<void> {
    if (!this.config.providers[provider]) throw new Error(`provider ${JSON.stringify(provider)} is not configured`);
    const target = this.target(provider, model);
    if (!role || role === "default") this.defaultTarget = target;
    else this.roles.set(role, target);
  }
  currentSelection(role: string): { provider: string; model: string; explicit: boolean } {
    if (!role || role === "default") return { provider: this.defaultTarget.provider, model: this.defaultTarget.model, explicit: true };
    const target = this.roles.get(role);
    return target ? { provider: target.provider, model: target.model, explicit: true } : { provider: this.defaultTarget.provider, model: this.defaultTarget.model, explicit: false };
  }
}

export function createModelSet(config: Config, factory?: ModelFactory): ModelSet { return new ModelSet(config, factory); }
