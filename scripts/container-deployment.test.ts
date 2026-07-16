import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
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
    expect(compose).toContain("stop_grace_period: 45s");
    expect(compose).toMatch(/worker:[\s\S]*healthcheck:/);
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

  it("validates Compose structure and shell entrypoints with executable tools", async () => {
    const docker = spawnSync("docker", ["compose", "config"], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
    if (docker.error && (docker.error as NodeJS.ErrnoException).code === "ENOENT") {
      const workflow = await load(".github/workflows/container-ci.yml");
      const smoke = await load(".github/scripts/container-smoke.sh");
      expect(workflow).toContain(".github/scripts/container-smoke.sh");
      expect(workflow).toContain("timeout-minutes:");
      expect(smoke).toContain("docker compose");
      expect(smoke).toContain("up -d --build postgres migrate web worker");
      expect(smoke).toContain("down --volumes");
      expect(smoke).toContain("/api/health/ready");
      expect(smoke).toContain("State.Health.Status");
    } else {
      expect(docker.status, docker.stderr).toBe(0);
    }

    for (const script of ["scripts/container-entrypoint.sh", "scripts/backup-postgres.sh", "scripts/restore-postgres.sh", ".github/scripts/container-smoke.sh"]) {
      await access(new URL(`../${script}`, import.meta.url), constants.X_OK);
      const syntax = spawnSync("sh", ["-n", script], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
      expect(syntax.status, syntax.stderr).toBe(0);
    }
    expect(spawnSync("sh", ["scripts/backup-postgres.sh", "--help"], { cwd: new URL("..", import.meta.url) }).status).toBe(0);
    expect(spawnSync("sh", ["scripts/restore-postgres.sh", "--help"], { cwd: new URL("..", import.meta.url) }).status).toBe(0);
    expect(await load("scripts/backup-postgres.sh")).toContain("export ENV_FILE");
    expect(await load("scripts/restore-postgres.sh")).toContain("export ENV_FILE");
    expect(spawnSync("sh", ["scripts/container-entrypoint.sh", "quota-reconcile", "--help"], { cwd: new URL("..", import.meta.url) }).status).toBe(0);
    expect(spawnSync("sh", ["scripts/container-entrypoint.sh", "credential-reencrypt", "--help"], { cwd: new URL("..", import.meta.url) }).status).toBe(0);
  });
});
