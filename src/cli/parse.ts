export type CLIOptions =
  | { command: "eval"; argv: string[] }
  | { command: "version" }
  | { command: "update"; updateVersion: string }
  | { command: "start"; configPath: string; headless: boolean; prompt: string; promptFile: string; args: string[] };

export function parseCLIOptions(argv: string[]): CLIOptions {
  if (argv[0] === "eval") return { command: "eval", argv: argv.slice(1) };
  let configPath = "", prompt = "", promptFile = "", updateVersion = "";
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
    else if (arg === "--prompt") prompt = requiredValue(argv, ++i, "--prompt");
    else if (arg === "--prompt-file") promptFile = requiredValue(argv, ++i, "--prompt-file");
    else args.push(arg);
  }
  if (prompt && promptFile) throw new Error("--prompt 和 --prompt-file 不能同时使用");
  if ((prompt || promptFile) && !headless) throw new Error("--prompt/--prompt-file 仅能在 --headless 模式下使用");
  if (version && (update || configPath || headless || prompt || promptFile || args.length)) throw new Error("version 不能与其他启动参数混用");
  if (update && (configPath || headless || prompt || promptFile || args.length)) throw new Error("update 不能与其他启动参数混用");
  if (version) return { command: "version" };
  if (update) return { command: "update", updateVersion };
  return { command: "start", configPath, headless, prompt, promptFile, args };
}

function requiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined) throw new Error(`${flag} 缺少值`);
  return value;
}
