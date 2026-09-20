export type CLIOptions =
  | { command: "eval"; argv: string[] }
  | { command: "version" }
  | { command: "update"; updateVersion: string }
  | { command: "mcp"; configPath: string }
  | { command: "migrate-files"; booksRoot: string; dbUrl: string }
  | { command: "verify-migration"; booksRoot: string; dbUrl: string }
  | { command: "edge-sync"; configPath: string; book: string }
  | { command: "start"; configPath: string; headless: boolean; web: boolean; port: number; prompt: string; promptFile: string; args: string[] };

export function parseCLIOptions(argv: string[]): CLIOptions {
  if (argv[0] === "eval") return { command: "eval", argv: argv.slice(1) };
  if (argv[0] === "mcp") return parseMcp(argv.slice(1));
  if (argv[0] === "edge-sync") return parseEdgeSync(argv.slice(1));
  if (argv[0] === "migrate-files" || argv[0] === "verify-migration") {
    const command = argv[0] === "migrate-files" ? "migrate-files" : "verify-migration";
    let booksRoot = "output";
    let dbUrl = process.env.DATABASE_URL || "sqlite:data/synchronicle.db";
    const rest = argv.slice(1);
    for (let i = 0; i < rest.length; i += 1) {
      if (rest[i] === "--books-root") booksRoot = requiredValue(rest, ++i, "--books-root");
      else if (rest[i] === "--db") dbUrl = requiredValue(rest, ++i, "--db");
      else throw new Error(`${command} 不接受参数 ${rest[i]}`);
    }
    return { command, booksRoot, dbUrl } as CLIOptions;
  }
  let configPath = "", prompt = "", promptFile = "", updateVersion = "";
  let port = 3000, web = true, webFlag = false;
  let headless = false, version = false, update = false;
  const args: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--version" || arg === "-v") version = true;
    else if (arg === "version") { if (i + 1 < argv.length) throw new Error("version 不接受参数"); version = true; }
    else if (arg === "update") {
      if (update) throw new Error("update 只能指定一次");
      update = true;
      if (argv[i + 1]?.startsWith("-")) throw new Error("update 只接受一个可选版本参数");
      if (argv[i + 1]) updateVersion = argv[++i]!;
      if (i + 1 < argv.length) throw new Error("update 只接受一个可选版本参数");
    } else if (arg === "--config") configPath = requiredValue(argv, ++i, "--config");
    else if (arg === "--headless") headless = true;
    else if (arg === "--web") { web = true; webFlag = true; }
    else if (arg === "--port") port = parsePort(requiredValue(argv, ++i, "--port"));
    else if (arg === "--prompt") prompt = requiredValue(argv, ++i, "--prompt");
    else if (arg === "--prompt-file") promptFile = requiredValue(argv, ++i, "--prompt-file");
    else args.push(arg);
  }
  if (prompt && promptFile) throw new Error("--prompt 和 --prompt-file 不能同时使用");
  if ((prompt || promptFile) && !headless) throw new Error("--prompt/--prompt-file 仅能在 --headless 模式下使用");
  if (version && (update || configPath || headless || webFlag || port !== 3000 || prompt || promptFile || args.length)) throw new Error("version 不能与其他启动参数混用");
  if (update && (configPath || headless || webFlag || port !== 3000 || prompt || promptFile || args.length)) throw new Error("update 不能与其他启动参数混用");
  if (version) return { command: "version" };
  if (update) return { command: "update", updateVersion };
  return { command: "start", configPath, headless, web, port, prompt, promptFile, args };
}

function parseMcp(argv: string[]): CLIOptions {
  let configPath = "";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--config") configPath = requiredValue(argv, ++i, "--config");
    else throw new Error(`mcp 不接受参数 ${arg}（仅支持 --config）`);
  }
  return { command: "mcp", configPath };
}

function parseEdgeSync(argv: string[]): CLIOptions {
  let configPath = "";
  let book = "";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--config") configPath = requiredValue(argv, ++i, "--config");
    else if (arg === "--book") book = requiredValue(argv, ++i, "--book");
    else throw new Error(`edge-sync 不接受参数 ${arg}（仅支持 --config/--book）`);
  }
  if (!book) throw new Error("edge-sync 需要 --book 指定书籍 ID");
  return { command: "edge-sync", configPath, book };
}

function requiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined) throw new Error(`${flag} 缺少值`);
  return value;
}

function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error("--port 必须是 1 到 65535 之间的整数");
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("--port 必须是 1 到 65535 之间的整数");
  return port;
}
