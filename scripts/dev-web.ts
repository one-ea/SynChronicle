import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from "node:child_process";

interface DevelopmentProcess {
  name: "server-build" | "fastify" | "vite";
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export function createDevelopmentProcesses(environment: NodeJS.ProcessEnv): DevelopmentProcess[] {
  const publicUrl = environment.PUBLIC_URL ?? "http://localhost:5173";
  const vitePort = new URL(publicUrl).port || (publicUrl.startsWith("https:") ? "443" : "80");
  const serverPort = environment.PORT ?? "3000";
  const backendUrl = `http://localhost:${serverPort}`;
  const serverEnvironment = { ...environment, PUBLIC_URL: publicUrl, PORT: serverPort };
  const viteEnvironment = { ...environment, VITE_BACKEND_URL: backendUrl };
  return [
    { name: "server-build", command: "pnpm", args: ["tsup", "--watch"], env: environment },
    { name: "fastify", command: "node", args: ["--watch", "--watch-preserve-output", "dist/web/main.js"], env: serverEnvironment },
    { name: "vite", command: "pnpm", args: ["vite", "--host", "0.0.0.0", "--port", vitePort], env: viteEnvironment },
  ];
}

function start(process: DevelopmentProcess): ChildProcess {
  const options: SpawnOptions = { env: process.env, stdio: "inherit" };
  return spawn(process.command, process.args, options);
}

export function runDevelopmentServers(environment: NodeJS.ProcessEnv = process.env): void {
  const initialBuild = spawnSync("pnpm", ["tsup"], { env: environment, stdio: "inherit" });
  if (initialBuild.status !== 0) process.exit(initialBuild.status ?? 1);
  const children = createDevelopmentProcesses(environment).map(start);
  let stopping = false;
  function stop(signal: NodeJS.Signals) {
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill(signal);
  }
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  for (const child of children) {
    child.on("exit", (code) => {
      if (stopping) return;
      stop("SIGTERM");
      process.exitCode = code ?? 1;
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) runDevelopmentServers();
