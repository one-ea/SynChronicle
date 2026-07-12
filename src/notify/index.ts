import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export interface Notification { kind: string; level: string; title: string; body: string }
export interface NotifyDependencies { deliver(command: string, notification: Notification): Promise<void> }
const systemDeliver: NotifyDependencies["deliver"] = async (command, n) => { if (!command) return; await exec("sh", ["-c", command], { timeout: 10_000, env: { ...process.env, NOTIFY_KIND: n.kind, NOTIFY_LEVEL: n.level, NOTIFY_TITLE: n.title, NOTIFY_BODY: n.body }, input: JSON.stringify(n) } as Parameters<typeof exec>[2]); };
export class Notifier {
  private readonly events?: Set<string>;
  constructor(private readonly command = "", events: string[] = [], private readonly dependencies: NotifyDependencies = { deliver: systemDeliver }) { if (events.length) this.events = new Set(events); }
  allows(kind: string): boolean { return !this.events || this.events.has(kind); }
  send(notification: Notification): void { if (this.allows(notification.kind)) void this.dependencies.deliver(this.command.trim(), notification).catch(() => undefined); }
  static new(command: string, events: string[]): Notifier { return new Notifier(command, events); }
}
