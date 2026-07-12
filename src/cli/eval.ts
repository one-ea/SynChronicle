import { loadCases } from "../eval/index.js";

interface EvalDependencies { writeStderr?: (text: string) => void; load?: typeof loadCases; run?: (options: EvalOptions) => Promise<0 | 1> }
export interface EvalOptions { cases: string; variant: string; config: string; out: string; maxChapters: number; timeout: string; repeat: number; ci: boolean }
export async function evalCommand(argv: string[], deps: EvalDependencies = {}): Promise<number> {
  const write = deps.writeStderr ?? ((text) => process.stderr.write(text));
  let options: EvalOptions;
  try { options = parseEvalOptions(argv); } catch (error) { write(`eval: ${message(error)}\n`); return 2; }
  if (!options.cases) { write("eval: 缺少 --cases\n"); return 2; }
  if (options.repeat <= 0) { write("eval: --repeat 必须大于 0\n"); return 2; }
  try { (deps.load ?? loadCases)(options.cases); return deps.run ? await deps.run(options) : 0; } catch (error) { write(`eval: ${message(error)}\n`); return 2; }
}
function parseEvalOptions(argv: string[]): EvalOptions { const out: EvalOptions = { cases: "", variant: "", config: "", out: "", maxChapters: -1, timeout: "30m", repeat: 1, ci: false }; for (let i = 0; i < argv.length; i += 1) { const arg = argv[i]!; if (arg === "--ci") out.ci = true; else { const value = argv[++i]; if (value === undefined) throw new Error(`${arg} 缺少值`); if (arg === "--cases") out.cases = value; else if (arg === "--variant") out.variant = value; else if (arg === "--config") out.config = value; else if (arg === "--out") out.out = value; else if (arg === "--max-chapters") out.maxChapters = Number(value); else if (arg === "--timeout") out.timeout = value; else if (arg === "--repeat") out.repeat = Number(value); else throw new Error(`未知参数 ${arg}`); } } return out; }
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
