import { access, chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    expect(spawnSync("sh", ["scripts/restore-postgres.sh", "backup.dump"], { cwd: new URL("..", import.meta.url) }).status).not.toBe(0);
    expect(await load("scripts/backup-postgres.sh")).toContain("export ENV_FILE");
    expect(await load("scripts/restore-postgres.sh")).toContain("export ENV_FILE");
    expect(spawnSync("sh", ["scripts/container-entrypoint.sh", "quota-reconcile", "--help"], { cwd: new URL("..", import.meta.url) }).status).toBe(0);
    expect(spawnSync("sh", ["scripts/container-entrypoint.sh", "credential-reencrypt", "--help"], { cwd: new URL("..", import.meta.url) }).status).toBe(0);
  });

  it("requires restore confirmation and performs a retained database switch", async () => {
    const restore = await load("scripts/restore-postgres.sh");

    expect(restore).toContain("--confirm-restore");
    expect(restore).toContain("--environment");
    expect(restore).toContain("PGDMP");
    expect(restore).toContain("stop web worker");
    expect(restore).toContain("DATABASE_NAME_OVERRIDE");
    expect(restore).toContain("RENAME TO");
    expect(restore).not.toContain("pg_restore --clean");
    expect(restore).toContain("restore failed; web and worker remain stopped");
    expect(restore).toContain("exec -T postgres sh -c");
    expect(restore).not.toMatch(/exec -T postgres (createdb|pg_restore|psql)/);
    expect(restore).toContain("trap restore_failure EXIT");
    expect(restore).toContain("trap 'exit 130' INT TERM");
  });

  it("checks worker readiness against the recorded worker process", async () => {
    const compose = await load("compose.yaml");
    expect(compose).toContain("synchronicle-worker-ready.json");
    expect(compose).toContain("/proc/");
    expect(compose).toContain("startedAt");
    expect(compose).not.toContain("kill -0 1");
  });

  it("mock executes restore as stop, candidate restore, retained rename, and restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "synchronicle-restore-"));
    const dump = join(directory, "backup.dump");
    const log = join(directory, "docker.log");
    const docker = join(directory, "docker");
    const curl = join(directory, "curl");
    await writeFile(dump, "PGDMPfixture");
    await writeFile(docker, `#!/bin/sh\nprintf '%s\\n' "$*" >> "$MOCK_LOG"\ncase "$*" in\n  *DEPLOYMENT_ENV*) printf production ;;\n  *POSTGRES_DB*) printf synchronicle ;;\nesac\n`);
    await writeFile(curl, "#!/bin/sh\nexit 0\n");
    await chmod(docker, 0o755);
    await chmod(curl, 0o755);

    const result = spawnSync("sh", ["scripts/restore-postgres.sh", "--confirm-restore", "--environment", "production", dump], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, MOCK_LOG: log, ENV_FILE: ".env.web.example" },
    });
    const commands = await readFile(log, "utf8");

    expect(result.status, result.stderr).toBe(0);
    expect(commands.indexOf("stop web worker")).toBeLessThan(commands.indexOf("createdb"));
    expect(commands).toContain("pg_restore --no-owner --exit-on-error");
    expect(commands).toContain("DATABASE_NAME_OVERRIDE=");
    expect(commands).toContain("RENAME TO");
    expect(commands).toContain("up -d web worker");
    expect(commands).toContain("port web 3000");
    expect(commands).toContain("exec -T web curl");
    expect(commands).not.toContain("dropdb");
  });

  it.each([
    ["0.0.0.0:49152", "http://127.0.0.1:49152/api/health/ready"],
    ["[::]:49153", "http://[::1]:49153/api/health/ready"],
  ])("detects the restored web endpoint from Compose mapping %s", async (mapping, expectedUrl) => {
    const directory = await mkdtemp(join(tmpdir(), "synchronicle-restore-port-"));
    const dump = join(directory, "backup.dump");
    const docker = join(directory, "docker");
    const curl = join(directory, "curl");
    const curlLog = join(directory, "curl.log");
    await writeFile(dump, "PGDMPfixture");
    await writeFile(docker, `#!/bin/sh\ncase "$*" in\n  *DEPLOYMENT_ENV*) printf production ;;\n  *POSTGRES_DB*) printf synchronicle ;;\n  *"port web 3000"*) printf '%s\\n' "$MOCK_PORT_OUTPUT" ;;\nesac\n`);
    await writeFile(curl, "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$MOCK_CURL_LOG\"\nexit 0\n");
    await chmod(docker, 0o755);
    await chmod(curl, 0o755);

    const result = spawnSync("sh", ["scripts/restore-postgres.sh", "--confirm-restore", "--environment", "production", dump], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, ENV_FILE: ".env.web.example", WEB_PORT: "39999", MOCK_PORT_OUTPUT: mapping, MOCK_CURL_LOG: curlLog },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(curlLog, "utf8")).toContain(expectedUrl);
  });

  it("falls back to an in-container health request when Web has no host mapping", async () => {
    const restore = await load("scripts/restore-postgres.sh");
    const dockerfile = await load("Dockerfile");
    expect(restore).toContain("port web 3000");
    expect(restore).toContain("exec -T web curl");
    expect(restore).not.toContain("PUBLIC_URL");
    expect(restore).not.toContain("WEB_PORT");
    expect(dockerfile).toMatch(/FROM node:24-bookworm-slim AS runtime[\s\S]*apt-get install[^\n]*curl/);
  });
});
