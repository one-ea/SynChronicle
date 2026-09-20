import { spawn } from "node:child_process";
export interface Notification { kind: string; level: string; title: string; body: string }
export interface NotifyDependencies { deliver(command: string, notification: Notification): Promise<void> }
const systemDeliver: NotifyDependencies["deliver"] = (command, n) => new Promise<void>((resolve, reject) => {
  // spawn 直写 stdin：promisify(execFile) 会静默忽略 input 选项，自定义命令拿不到 JSON
  const child = spawn("sh", ["-c", command], { env: { ...process.env, NOTIFY_KIND: n.kind, NOTIFY_LEVEL: n.level, NOTIFY_TITLE: n.title, NOTIFY_BODY: n.body } });
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  child.on("error", (error) => { clearTimeout(timer); reject(error); });
  child.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`notify command exited with ${code}`)); });
  child.stdin.on("error", () => undefined);
  child.stdin.end(JSON.stringify(n));
});
export class Notifier {
  private readonly events?: Set<string>;
  constructor(private readonly command = "", events: string[] = [], private readonly dependencies: NotifyDependencies = { deliver: systemDeliver }) { if (events.length) this.events = new Set(events); }
  /** 事件名别名：实际发送的 run 兼容文档中的 run_end 写法，避免合法过滤把通知全部滤掉。 */
  allows(kind: string): boolean { return !this.events || this.events.has(kind) || (kind === "run" && this.events.has("run_end")); }
  send(notification: Notification): void { if (this.allows(notification.kind)) void this.dependencies.deliver(this.command.trim(), notification).catch(() => undefined); }
  static new(command: string, events: string[]): Notifier { return new Notifier(command, events); }
}
