import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";

interface ManagedProcess {
  id: string;
  child: ChildProcess;
  running: boolean;
}

interface OrchestratorOptions {
  env: NodeJS.ProcessEnv;
  spawn?: (entry: string, env: NodeJS.ProcessEnv) => ChildProcess;
}

export class TestProcessOrchestrator {
  private readonly spawn: (entry: string, env: NodeJS.ProcessEnv) => ChildProcess;
  private web: ManagedProcess | null = null;
  private worker: ManagedProcess | null = null;
  private workerSequence = 0;

  constructor(private readonly options: OrchestratorOptions) {
    this.spawn = options.spawn ?? ((entry, env) => nodeSpawn(process.execPath, [entry], { env, stdio: "inherit" }));
  }

  startWeb(): void {
    if (this.web?.running) return;
    this.web = this.start("web", "dist/web/main.js", this.options.env);
  }

  startWorker(): void {
    if (this.worker?.running) throw new Error("test Worker is already running");
    this.workerSequence += 1;
    const id = `e2e-worker-${this.workerSequence}`;
    this.worker = this.start(id, "dist/worker/main.js", { ...this.options.env, WORKER_ID: id });
  }

  killWorker(): Promise<void> {
    if (!this.worker?.running) throw new Error("test Worker is not running");
    const worker = this.worker;
    const exited = new Promise<void>((resolve) => worker.child.once("exit", () => resolve()));
    worker.child.kill("SIGKILL");
    return exited;
  }

  shutdown(): void {
    for (const process of [this.worker, this.web]) if (process?.running) process.child.kill("SIGTERM");
  }

  snapshot() {
    return {
      web: this.web ? { id: this.web.id, pid: this.web.child.pid, running: this.web.running } : null,
      worker: this.worker ? { id: this.worker.id, pid: this.worker.child.pid, running: this.worker.running } : null,
    };
  }

  private start(id: string, entry: string, env: NodeJS.ProcessEnv): ManagedProcess {
    const child = this.spawn(entry, env);
    const managed = { id, child, running: true };
    child.once("exit", () => { managed.running = false; });
    return managed;
  }
}
