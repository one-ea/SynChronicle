import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { platformModels, providerCredentials, userModelSets } from "../../db/schema/index.js";
import type { RequestAuth } from "../auth/plugin.js";
import { validateModelSetInput, type ModelCatalog } from "./modelConfig.js";
import { hasKnownPlatformPrice } from "../../quota/pricing.js";
import { normalizePlatformModelCapabilities } from "../../models/capabilities.js";

export class ModelConfigurationRepository {
  constructor(private readonly db: Database) {}

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

  async list(auth: RequestAuth) {
    return this.db.select({ id: userModelSets.modelSetId, name: userModelSets.name, version: userModelSets.version, agents: userModelSets.agents, active: userModelSets.active }).from(userModelSets)
      .where(eq(userModelSets.userId, auth.userId)).orderBy(desc(userModelSets.createdAt));
  }

  async create(auth: RequestAuth, input: unknown) {
    const validated = validateModelSetInput(input, await this.catalog(auth));
    const [row] = await this.db.insert(userModelSets).values({ userId: auth.userId, name: validated.name, version: 1, agents: validated.agents }).returning();
    return row!;
  }

  async revise(auth: RequestAuth, modelSetId: string, input: unknown) {
    const validated = validateModelSetInput(input, await this.catalog(auth));
    return this.db.transaction(async (transaction) => {
      const [latest] = await transaction.select({ version: userModelSets.version }).from(userModelSets).where(and(eq(userModelSets.userId, auth.userId), eq(userModelSets.modelSetId, modelSetId))).orderBy(desc(userModelSets.version)).limit(1).for("update");
      if (!latest) return null;
      const [row] = await transaction.insert(userModelSets).values({ modelSetId, userId: auth.userId, name: validated.name, version: latest.version + 1, agents: validated.agents }).returning();
      return row!;
    });
  }

  async activate(auth: RequestAuth, modelSetId: string) {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${auth.userId}))`);
      const rows = await transaction.select({ id: userModelSets.id }).from(userModelSets).where(and(eq(userModelSets.userId, auth.userId), eq(userModelSets.modelSetId, modelSetId))).orderBy(desc(userModelSets.version)).limit(1).for("update");
      if (!rows[0]) return false;
      await transaction.update(userModelSets).set({ active: 0 }).where(eq(userModelSets.userId, auth.userId));
      await transaction.update(userModelSets).set({ active: 1 }).where(and(eq(userModelSets.userId, auth.userId), eq(userModelSets.id, rows[0].id)));
      return true;
    });
  }

  async projection(auth: RequestAuth) {
    const [sets, catalog] = await Promise.all([this.list(auth), this.catalog(auth)]);
    const latest = new Map<string, typeof sets[number]>();
    for (const row of sets) if (!latest.has(row.id)) latest.set(row.id, row);
    const providers = new Map<string, { provider: string; models: string[]; credentials: Array<{ id: string; label: string }> }>();
    for (const { provider, model } of catalog.platformModels) {
      const entry = providers.get(provider) ?? { provider, models: [], credentials: [] };
      if (!entry.models.includes(model)) entry.models.push(model);
      providers.set(provider, entry);
    }
    for (const credential of catalog.credentials) {
      const entry = providers.get(credential.provider) ?? { provider: credential.provider, models: [], credentials: [] };
      entry.credentials.push({ id: credential.id, label: credential.label ?? `${credential.provider} credential` });
      providers.set(credential.provider, entry);
    }
    return { activeModelSetId: sets.find(({ active }) => active === 1)?.id, modelSets: [...latest.values()], providers: [...providers.values()] };
  }
}
