import { readFile } from "node:fs/promises";
import { loadAssets } from "../assets/load.js";
import { loadConfig, needsSetup } from "../config/index.js";
import { run as runHeadless } from "../headless/run.js";
import type { CLIOptions } from "./parse.js";
import { evalCommand } from "./eval.js";
import { updateCommand } from "./update.js";
import { printVersion } from "./version.js";
import { startWebServer } from "../web/server.js";
import { startMcpServer } from "../mcp/index.js";

export interface DispatchDependencies { readPrompt?: (path: string) => Promise<string>; runWeb?: (options: { configPath?: string; port: number }) => Promise<void>; runMcp?: (options: { configPath?: string }) => Promise<void> }
export async function dispatch(options: CLIOptions, deps: DispatchDependencies = {}): Promise<number> { if (options.command === "version") { printVersion(); return 0; } if (options.command === "update") { await updateCommand(options.updateVersion); return 0; } if (options.command === "eval") return evalCommand(options.argv); if (options.command === "mcp") { await (deps.runMcp ?? (async ({ configPath }) => { await startMcpServer({ configPath: configPath || undefined }); }))({ configPath: options.configPath }); return 0; } if (options.args.length) throw new Error("不再支持命令行直接传入小说需求，请通过浏览器中的 WebUI 输入"); if (options.headless) { if (await needsSetup(options.configPath || undefined)) throw new Error("headless 模式需要先准备配置文件"); const config = await loadConfig(options.configPath || undefined); const bundle = loadAssets(config.style); await runHeadless(config, bundle, { prompt: await loadPrompt(options.prompt, options.promptFile, deps.readPrompt ?? defaultReadPrompt) }); return 0; } const runWeb = deps.runWeb ?? (async ({ configPath, port }) => { const server = await startWebServer({ configPath, port }); process.stdout.write(`SynChronicle WebUI: http://127.0.0.1:${server.port}\n`); }); await runWeb({ configPath: options.configPath || undefined, port: options.port }); return 0; }
export async function loadPrompt(prompt: string, promptFile: string, read: (path: string) => Promise<string> = defaultReadPrompt): Promise<string> { return (promptFile ? await read(promptFile) : prompt).trim(); }
async function defaultReadPrompt(path: string) { try { return await readFile(path === "-" ? "/dev/stdin" : path, "utf8"); } catch (error) { throw new Error(`读取 prompt 失败: ${error instanceof Error ? error.message : String(error)}`); } }
