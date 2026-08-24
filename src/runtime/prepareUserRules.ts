import { join } from "node:path";
import { generateText, type LanguageModel } from "ai";
import { defaultConfigDir } from "../config/index.js";
import type { ModelSet } from "../providers/index.js";
import { buildSnapshot, normalizeRule, rawFileSources, type Candidate, type RuleGenerator } from "../rules/index.js";
import type { Store } from "../store/index.js";

type LanguageModelInstance = Exclude<LanguageModel, string>;

function ruleGenerator(model: LanguageModelInstance): RuleGenerator {
  return async (messages) => {
    const result = await generateText({
      model,
      messages: messages.map(m => ({ role: m.role as "system" | "user" | "assistant", content: m.content })),
    });
    return result.text;
  };
}

/**
 * 启动路径规则快照：开书前把 `~/.synchronicle/rules/*.md` 与 `./.synchronicle/rules/*.md`
 * 的自然语言规则归一化并合并为 `meta/user_rules.json`。
 *
 * - 幂等：快照已存在（含旧 degraded 直存格式）则跳过，不重复消耗 LLM；
 * - 无规则文件则跳过；
 * - 归一化失败在 normalizeRule 内部降级为原文偏好（degraded），不阻断启动。
 */
export async function prepareUserRules(store: Store, models: ModelSet): Promise<void> {
  if (await store.userRules.load()) return;
  const sources = rawFileSources({
    homeRulesDir: join(defaultConfigDir(), "rules"),
    projectRulesDir: join(process.cwd(), ".synchronicle", "rules"),
  });
  if (!sources.length) return;
  const generate = ruleGenerator(models.forRole("writer"));
  const candidates: Candidate[] = [];
  for (const source of sources) {
    try {
      candidates.push(await normalizeRule(source.label, source.text, generate));
    } catch {
      candidates.push({ source: source.label, structured: {}, preferences: source.text, uncertain: [`${source.label}：归一化调用异常，已按原文处理`], degraded: true });
    }
  }
  await store.userRules.save(buildSnapshot(candidates));
}
