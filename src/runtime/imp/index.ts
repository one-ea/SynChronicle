import { readFile } from "node:fs/promises";
import { splitChapters, type ImportedChapter } from "./chapters.js";

export type { ImportedChapter };
export { splitChapters };

export async function importTextFile(path: string): Promise<ImportedChapter[]> {
  const text = (await readFile(path, "utf8")).replace(/^\uFEFF/, "");
  return splitChapters(text);
}
