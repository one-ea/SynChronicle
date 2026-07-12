import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
export async function simulateSources(sources: string[]): Promise<{ sources: number; fingerprint: string }> { const hash = createHash("sha256"); for (const source of sources) hash.update(await readFile(source)); return { sources: sources.length, fingerprint: hash.digest("hex") }; }
