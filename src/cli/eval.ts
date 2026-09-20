import { loadCases } from "../eval/index.js";
import { runEval, type EvalOptions } from "../eval/run.js";

interface EvalDependencies {
  writeStderr?: (text: string) => void;
  load?: typeof loadCases;
  run?: (options: EvalOptions) => Promise<0 | 1>;
}

export async function evalCommand(argv: string[], deps: EvalDependencies = {}): Promise<number> {
  const write = deps.writeStderr ?? ((text) => process.stderr.write(text));
  let options: EvalOptions;
  try {
    options = parseEvalOptions(argv);
  } catch (error) {
    write(`eval: ${message(error)}\n`);
    return 2;
  }
  if (!options.cases) {
    write("eval: 缺少 --cases\n");
    return 2;
  }
  if (options.repeat <= 0) {
    write("eval: --repeat 必须大于 0\n");
    return 2;
  }
  try {
    (deps.load ?? loadCases)(options.cases);
    return deps.run ? await deps.run(options) : await runEval(options, { stderr: (text) => write(text) });
  } catch (error) {
    write(`eval: ${message(error)}\n`);
    return 2;
  }
}

function parseEvalOptions(argv: string[]): EvalOptions {
  const out: EvalOptions = {
    cases: "",
    variant: "",
    config: "",
    out: "",
    maxChapters: -1,
    timeout: "30m",
    repeat: 1,
    ci: false,
    judge: null,
  };
  let judgeSeen = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--ci") {
      out.ci = true;
    } else if (arg === "--judge" || arg === "--no-judge") {
      if (judgeSeen) throw new Error("--judge 与 --no-judge 不能同时使用");
      judgeSeen = true;
      out.judge = arg === "--judge";
    } else {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} 缺少值`);
      if (arg === "--cases") out.cases = value;
      else if (arg === "--variant") out.variant = value;
      else if (arg === "--config") out.config = value;
      else if (arg === "--out") out.out = value;
      else if (arg === "--max-chapters") out.maxChapters = intOnly(value, arg);
      else if (arg === "--timeout") out.timeout = value;
      else if (arg === "--repeat") out.repeat = intOnly(value, arg);
      else throw new Error(`未知参数 ${arg}`);
    }
  }
  return out;
}

/** 数字参数校验：NaN/非整数（如 `--repeat abc`）在入口报错，避免静默空跑；具体取值范围留给 evalCommand 校验。 */
function intOnly(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${flag} 必须是整数`);
  return parsed;
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
