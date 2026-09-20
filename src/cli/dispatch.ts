import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadAssets } from "../assets/load.js";
import { loadConfig, needsSetup } from "../config/index.js";
import { run as runHeadless } from "../headless/run.js";
import type { CLIOptions } from "./parse.js";
import { evalCommand } from "./eval.js";
import { updateCommand } from "./update.js";
import { printVersion } from "./version.js";
import { startWebServer } from "../web/server.js";
import { startMcpServer } from "../mcp/index.js";
import { migrateFilesCommand, verifyMigrationCommand } from "../db/migrate-files.js";
import { pushBook } from "../platform/edgesync.js";
import { FileIO } from "../store/io.js";
import { resolveBooksRoot } from "../domain/bookshelf.js";

export interface DispatchDependencies { readPrompt?: (path: string) => Promise<string>; runWeb?: (options: { configPath?: string; port: number }) => Promise<void>; runMcp?: (options: { configPath?: string }) => Promise<void> }
export async function dispatch(options: CLIOptions, deps: DispatchDependencies = {}): Promise<number> { if (options.command === "version") { printVersion(); return 0; } if (options.command === "help") { printUsage(); return 0; } if (options.command === "update") { await updateCommand(options.updateVersion); return 0; } if (options.command === "eval") return evalCommand(options.argv); if (options.command === "mcp") { await (deps.runMcp ?? (async ({ configPath }) => { await startMcpServer({ configPath: configPath || undefined }); }))({ configPath: options.configPath }); return 0; } if (options.command === "migrate-files") return migrateFilesCommand(options.booksRoot, options.dbUrl); if (options.command === "verify-migration") return verifyMigrationCommand(options.booksRoot, options.dbUrl); if (options.command === "edge-sync") return edgeSyncCommand(options.configPath, options.book); if (options.args.length) throw new Error("不再支持命令行直接传入小说需求，请通过浏览器中的 WebUI 输入"); if (options.headless) { if (await needsSetup(options.configPath || undefined)) throw new Error("headless 模式需要先准备配置文件"); const config = await loadConfig(options.configPath || undefined); const bundle = loadAssets(config.style); await runHeadless(config, bundle, { prompt: await loadPrompt(options.prompt, options.promptFile, deps.readPrompt ?? defaultReadPrompt) }); return 0; } const runWeb = deps.runWeb ?? (async ({ configPath, port }) => { const mode = process.env.MODE === "commercial" ? "commercial" : "selfhost"; const dbUrl = process.env.DATABASE_URL ?? "sqlite:data/synchronicle.db"; if (mode === "commercial" && dbUrl.startsWith("sqlite:")) throw new Error("商用模式要求 DATABASE_URL 使用 postgres:// 或 mysql://（SQLite 仅限自用模式）"); const server = await startWebServer({ configPath, port, storage: "db", dbUrl, mode }); process.stdout.write(`SynChronicle WebUI: http://127.0.0.1:${server.port}\n`); }); await runWeb({ configPath: options.configPath || undefined, port: options.port }); return 0; }

function printUsage(): void {
  process.stdout.write(`SynChronicle — 多智能体 AI 小说写作引擎

用法：
  synchronicle [选项]                 启动 WebUI（默认）
  synchronicle eval [参数]            运行评测用例
  synchronicle version                 显示版本
  synchronicle update [版本]           自更新
  synchronicle mcp [--config <路径>]   启动 MCP 服务器
  synchronicle edge-sync --book <id> [--config <路径>]  推送书籍到边缘
  synchronicle migrate-files [--books-root <目录>] [--db <URL>]   迁移文件工作区到数据库
  synchronicle verify-migration        校验迁移结果

选项：
  --config <路径>      指定配置文件
  --port <端口>        WebUI 监听端口（默认 3000）
  --headless           无界面模式（配合 --prompt/--prompt-file）
  --prompt <文本>      headless 模式的创作需求
  --prompt-file <路径> headless 模式的需求文件
  -v, --version        显示版本
  -h, --help           显示本帮助
`);
}

async function edgeSyncCommand(configPath: string, book: string): Promise<number> {  const url = process.env.EDGE_RELAY_URL;
  const token = process.env.EDGE_RELAY_TOKEN;
  if (!url || !token) throw new Error("edge-sync 需要 EDGE_RELAY_URL 与 EDGE_RELAY_TOKEN 环境变量");
  const config = await loadConfig(configPath || undefined);
  const booksRoot = resolve(resolveBooksRoot(config.output_dir ?? "output/novel"));
  const io = new FileIO(booksRoot);
  const raw = await io.readJSON<{ books?: unknown }>("bookshelf.json");
  const books = Array.isArray(raw?.books) ? (raw as { books: Array<{ id: string; ownerId: string; title: string }> }).books : [];
  const { pushed } = await pushBook({ url, token, booksRoot, getBookshelf: async () => books }, book);
  process.stdout.write(`已同步书籍 ${book}：${pushed} 个文件推送到 ${url}\n`);
  return 0;
}
export async function loadPrompt(prompt: string, promptFile: string, read: (path: string) => Promise<string> = defaultReadPrompt): Promise<string> { return (promptFile ? await read(promptFile) : prompt).trim(); }
async function defaultReadPrompt(path: string) { try { return await readFile(path === "-" ? "/dev/stdin" : path, "utf8"); } catch (error) { throw new Error(`读取 prompt 失败: ${error instanceof Error ? error.message : String(error)}`); } }
