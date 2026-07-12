import type { TuiHost } from "./events.js";

export interface ParsedCommand { name: string; args: string[] }
export function parseCommand(text: string): ParsedCommand | null { const fields = text.trim().split(/\s+/); if (!fields[0]?.startsWith("/")) return null; return { name: fields[0].slice(1).toLowerCase(), args: fields.slice(1) }; }

export async function executeCommand(host: TuiHost, command: ParsedCommand): Promise<string> {
  if (command.name === "model") { const [role = "default", provider, model] = command.args; if (!provider || !model) return "用法: /model [role] <provider> <model>"; if (!host.switchModel) return "当前 Host 不支持模型热切换"; await host.switchModel(role, provider, model); return `已切换 ${role}: ${provider}/${model}`; }
  if (command.name === "diag") { const result = host.diagnose ? await host.diagnose() : { summary: JSON.stringify(host.snapshot()) }; return result.path ? `${result.summary} · ${result.path}` : result.summary; }
  if (command.name === "export") { const [formatArg = "txt", path, ...range] = command.args; const format = formatArg === "epub" ? "epub" : "txt"; const values = Object.fromEntries(range.map((item) => item.split("=", 2))); const result = await host.export({ format, path, from: number(values.from), to: number(values.to) }); return `已导出 ${result.chapters} 章到 ${result.path}`; }
  if (command.name === "import") { const [path] = command.args; if (!path) return "用法: /import <path>"; const result = await host.importText(path); return `已导入 ${result.chapters} 章` ; }
  return `未知命令: /${command.name}`;
}
function number(value?: string): number | undefined { if (value === undefined) return undefined; const parsed = Number(value); return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined; }
