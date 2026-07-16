import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const load = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("container deployment contract", () => {
  it("builds a production image and runs as a non-root user", async () => {
    const dockerfile = await load("Dockerfile");

    expect(dockerfile).toContain("FROM node:24-bookworm-slim AS build");
    expect(dockerfile).toContain("FROM node:24-bookworm-slim AS runtime");
    expect(dockerfile).toContain("pnpm typecheck");
    expect(dockerfile).toContain("pnpm build");
    expect(dockerfile).toContain("USER node");
    expect(dockerfile).toContain('ENTRYPOINT ["./scripts/container-entrypoint.sh"]');
  });

  it("defines one public web port and gated web, worker, and postgres services", async () => {
    const compose = await load("compose.yaml");

    expect(compose).toMatch(/^\s{2}postgres:/m);
    expect(compose).toMatch(/^\s{2}migrate:/m);
    expect(compose).toMatch(/^\s{2}web:/m);
    expect(compose).toMatch(/^\s{2}worker:/m);
    expect(compose.match(/\n\s+ports:/g)).toHaveLength(1);
    expect(compose).toContain("condition: service_completed_successfully");
    expect(compose).toContain("postgres_data:/var/lib/postgresql/data");
    expect(compose).toContain("restart: unless-stopped");
    expect(compose).toContain("resources:");
    expect(compose).toContain("/api/health/live");
    expect(compose).toContain("/api/health/ready");
  });

  it("ships placeholder-only production configuration and operations commands", async () => {
    const environment = await load(".env.web.example");
    const entrypoint = await load("scripts/container-entrypoint.sh");
    const operations = await load("docs/operations/container-deployment.md");

    expect(environment).toContain("PROJECT_CREDENTIAL_MASTER_KEYS=");
    expect(environment).toContain("PROJECT_CREDENTIAL_MASTER_KEY_VERSION=");
    expect(environment).toContain("PROJECT_PROVIDER_ALLOWED_HOSTS=");
    expect(environment).toContain("DATABASE_URL=");
    expect(environment).toContain("PUBLIC_URL=");
    expect(environment).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(entrypoint).toContain("pg_advisory_lock");
    expect(entrypoint).toContain('case "$command" in');
    for (const topic of ["backup", "restore", "key rotation", "scale worker", "quota reconcile", "troubleshooting"]) {
      expect(operations.toLowerCase()).toContain(topic);
    }
  });
});
