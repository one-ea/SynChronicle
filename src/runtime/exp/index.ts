import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { StorePort } from "../../store/index.js";
export interface ExportOptions { format: "txt" | "epub"; path?: string; from?: number; to?: number }
export async function exportNovel(store: StorePort, options: ExportOptions): Promise<{ path: string; chapters: number }> { const progress = await store.progress.load(); if (!progress?.completed_chapters.length) throw new Error("没有可导出的已完成章节"); const chapters = progress.completed_chapters.filter((chapter) => chapter >= (options.from ?? 1) && chapter <= (options.to ?? Number.MAX_SAFE_INTEGER)); const title = progress.novel_name.trim() || "novel"; const output = options.path ?? join(store.dir, `${safeName(title)}.${options.format}`); const bodies = await Promise.all(chapters.map(async (chapter) => ({ chapter, body: await store.drafts.loadChapterText(chapter) ?? "" }))); if (options.format === "txt") await writeFile(output, [progress.novel_name, ...bodies.map(({ chapter, body }) => `第 ${chapter} 章\n\n${body}`)].filter(Boolean).join("\n\n"), "utf8"); else await writeFile(output, makeEpub(title, bodies), "binary"); return { path: output, chapters: chapters.length }; }
function safeName(value: string): string { return basename(value.replace(/[\\/:*?"<>|]/g, "_")).trim() || "novel"; }
function makeEpub(title: string, chapters: Array<{ chapter: number; body: string }>): Buffer {
  const escapedTitle = xml(title);
  const files = [
    ["mimetype", "application/epub+zip"],
    ["META-INF/container.xml", `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`],
    ["OEBPS/content.opf", `<?xml version="1.0"?><package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="book"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book">urn:synchronicle:${safeName(title)}</dc:identifier><dc:title>${escapedTitle}</dc:title><dc:language>zh-CN</dc:language></metadata><manifest>${chapters.map(({ chapter }) => `<item id="c${chapter}" href="chapter-${chapter}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine>${chapters.map(({ chapter }) => `<itemref idref="c${chapter}"/>`).join("")}</spine></package>`],
    ...chapters.map(({ chapter, body }) => [`OEBPS/chapter-${chapter}.xhtml`, `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>第 ${chapter} 章</title></head><body><h1>第 ${chapter} 章</h1>${body.split(/\n{2,}/).map((paragraph) => `<p>${xml(paragraph)}</p>`).join("")}</body></html>`]),
  ] as Array<[string, string]>;
  return zip(files);
}

function xml(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function zip(files: Array<[string, string]>): Buffer {
  const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const [name, content] of files) {
    const fileName = Buffer.from(name); const data = Buffer.from(content); const checksum = crc32(data);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt32LE(checksum, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(fileName.length, 26);
    local.push(header, fileName, data);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt32LE(checksum, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(fileName.length, 28); entry.writeUInt32LE(offset, 42); central.push(entry, fileName);
    offset += header.length + fileName.length + data.length;
  }
  const centralData = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralData.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralData, end]);
}
function crc32(data: Buffer): number { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
