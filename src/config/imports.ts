import { homedir } from "node:os";
import { join } from "node:path";

export function resolveImportPath(path: string): string {
  return path.startsWith("~/") ? join(process.env.HOME || homedir(), path.slice(2)) : path;
}

export const ResolveImportPath = resolveImportPath;
