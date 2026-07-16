import { readFile } from "node:fs/promises";
import { loadAssets } from "../assets/load.js";
import { loadConfig, needsSetup, runSetup } from "../config/index.js";
import { migrateFileProject, run as runHeadless } from "../headless/run.js";
import type { CLIOptions } from "./parse.js";
import { evalCommand } from "./eval.js";
import { updateCommand } from "./update.js";
import { printVersion } from "./version.js";

export interface DispatchDependencies { readPrompt?: (path: string) => Promise<string>; runTui?: (config: Awaited<ReturnType<typeof loadConfig>>, bundle: ReturnType<typeof loadAssets>) => Promise<void>; migrateFileProject?: typeof migrateFileProject }
export async function dispatch(options: CLIOptions, deps: DispatchDependencies = {}): Promise<number> { if (options.command === "version") { printVersion(); return 0; } if (options.command === "update") { await updateCommand(options.updateVersion); return 0; } if (options.command === "eval") return evalCommand(options.argv); if (options.command === "web") { const { startWebServer } = await import("../web/main.js"); await startWebServer(); return 0; } if (options.command === "worker") { const { startWorker } = await import("../worker/main.js"); await startWorker(); return 0; } if (options.command === "migrate-project") { await (deps.migrateFileProject ?? migrateFileProject)(options); return 0; } if (options.args.length) throw new Error("不再支持命令行直接传入小说需求，请启动后在 TUI 输入框中输入"); if (await needsSetup(options.configPath || undefined)) { if (options.headless) throw new Error("headless 模式不支持首次引导，请先运行一次 TUI 完成配置"); await runSetup(); } const config = await loadConfig(options.configPath || undefined); const bundle = loadAssets(config.style); if (options.headless) { await runHeadless(config, bundle, { prompt: await loadPrompt(options.prompt, options.promptFile, deps.readPrompt ?? defaultReadPrompt) }); return 0; } if (!deps.runTui) throw new Error("TUI 尚未实现"); await deps.runTui(config, bundle); return 0; }
export async function loadPrompt(prompt: string, promptFile: string, read: (path: string) => Promise<string> = defaultReadPrompt): Promise<string> { return (promptFile ? await read(promptFile) : prompt).trim(); }
async function defaultReadPrompt(path: string) { try { return await readFile(path === "-" ? "/dev/stdin" : path, "utf8"); } catch (error) { throw new Error(`读取 prompt 失败: ${error instanceof Error ? error.message : String(error)}`); } }
