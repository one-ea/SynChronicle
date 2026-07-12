#!/usr/bin/env node
import { dispatch } from "./dispatch.js";
import { parseCLIOptions } from "./parse.js";

export async function main(argv = process.argv.slice(2)): Promise<number> { try { return await dispatch(parseCLIOptions(argv)); } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); return 1; } }
if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await main();
