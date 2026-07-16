import type { FastifyPluginAsync } from "fastify";

export type HealthRoutesOptions = {
  checkReadiness: () => Promise<void>;
};

export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (app, options) => {
  app.get("/live", async () => ({ status: "ok" as const }));
  app.get("/ready", async (_request, reply) => {
    try {
      await options.checkReadiness();
      return { status: "ready" as const };
    } catch {
      return reply.code(503).send({ status: "unavailable" as const });
    }
  });
};
