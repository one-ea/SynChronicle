import { FileIO, setWriteObserver } from "../store/io.js";

/**
 * P11-C3 边缘内容同步：Node 主线书稿写入 → Cloudflare Worker D1 kv。
 * - 通过 FileIO 写入观察器收集脏路径（fs/db 后端均覆盖）
 * - 去抖 3 秒后按书籍分批推送（每批 ≤ 40 文件），附带所有权映射与书架
 * - flush 时重新读取当前内容（append 类写法自动取到最新全文）
 * 失败保留脏标记等下轮重试；EDGE_RELAY_URL 未配置时完全旁路。
 */

export interface EdgeSyncOptions {
  url: string;
  token: string;
  booksRoot: string;
  getBookshelf(): Promise<Array<{ id: string; ownerId: string; title: string }>>;
}

interface DirtyEntry { dir: string; rel: string; tombstone: boolean }

const dirty = new Map<string, DirtyEntry>();
let options: EdgeSyncOptions | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
const DEBOUNCE_MS = 3000;
const BATCH_LIMIT = 40;

export function startEdgeSync(config: EdgeSyncOptions): void {
  options = config;
  setWriteObserver((dir, rel, kind) => {
    if (!options) return;
    const key = `${dir}\u0000${rel}`;
    dirty.set(key, { dir, rel, tombstone: kind === "remove" });
    schedule();
  });
}

export function stopEdgeSync(): void {
  options = null;
  setWriteObserver(null);
  if (timer) { clearTimeout(timer); timer = null; }
  dirty.clear();
}

function schedule(): void {
  if (timer || flushing) return;
  timer = setTimeout(() => { timer = null; void flushEdgeSync().catch(() => undefined); }, DEBOUNCE_MS);
  if (typeof timer === "object" && "unref" in timer) (timer as { unref(): void }).unref();
}

/** 立即冲刷全部脏路径；供测试与 CLI 显式调用。 */
export async function flushEdgeSync(): Promise<{ pushed: number; books: number }> {
  if (!options || flushing || dirty.size === 0) return { pushed: 0, books: 0 };
  flushing = true;
  const snapshot = [...dirty.values()];
  try {
    const root = resolveDir(options.booksRoot);
    const byBook = new Map<string, DirtyEntry[]>();
    let bookshelfEntry: DirtyEntry | null = null;
    for (const entry of snapshot) {
      const dirRel = relativeUnder(root, resolveDir(entry.dir));
      if (dirRel === null) continue;
      // 完整文件相对路径 = 目录相对路径 + 文件名
      const fileRel = dirRel === "." ? entry.rel : `${dirRel}/${entry.rel}`;
      if (fileRel === "bookshelf.json") { bookshelfEntry = entry; continue; }
      const [book, ...rest] = fileRel.split("/");
      if (!book || rest.length === 0) continue;
      const list = byBook.get(book) ?? [];
      list.push({ ...entry, rel: rest.join("/") });
      byBook.set(book, list);
    }
    const shelf = await options.getBookshelf();
    let pushed = 0;
    for (const [book, entries] of byBook) {
      const meta = shelf.find((item) => item.id === book);
      const writes: Array<{ path: string; content: string }> = [];
      const deletes: string[] = [];
      for (const entry of entries) {
        if (entry.tombstone) deletes.push(`books/${book}/${entry.rel}`);
        else {
          const content = await new FileIO(entry.dir).readText(entry.rel);
          if (content) writes.push({ path: `books/${book}/${entry.rel}`, content });
          else deletes.push(`books/${book}/${entry.rel}`);
        }
      }
      for (let offset = 0; offset < writes.length || offset === 0; offset += BATCH_LIMIT) {
        const chunk = writes.slice(offset, offset + BATCH_LIMIT);
        const tombstones = offset === 0 ? deletes.slice(0, 60) : [];
        if (!chunk.length && !tombstones.length) break;
        const response = await post("/api/internal/sync", { book, owner: meta?.ownerId ?? "", writes: chunk, deletes: tombstones });
        if (!response.ok) throw new Error(`edge sync failed: ${response.status}`);
        pushed += chunk.length + tombstones.length;
      }
    }
    if (bookshelfEntry) {
      const content = await new FileIO(bookshelfEntry.dir).readText("bookshelf.json");
      if (content) {
        const response = await post("/api/internal/sync", { writes: [{ path: "platform/bookshelf.json", content }], deletes: [] });
        if (!response.ok) throw new Error(`edge sync bookshelf failed: ${response.status}`);
        pushed += 1;
      }
    }
    for (const entry of snapshot) if (dirty.get(`${entry.dir}\u0000${entry.rel}`) === entry) dirty.delete(`${entry.dir}\u0000${entry.rel}`);
    return { pushed, books: byBook.size };
  } finally {
    flushing = false;
  }
}

/** 一次性推送整本书（CLI edge-sync --book）。 */
export async function pushBook(config: EdgeSyncOptions, bookId: string): Promise<{ pushed: number }> {
  const root = resolveDir(config.booksRoot);
  const io = new FileIO(`${root.replace(/\/$/, "")}/${bookId}`);
  const files = await walk(io, ".");
  const writes: Array<{ path: string; content: string }> = [];
  for (const rel of files) {
    // kv 后端把无子键的空目录也列为文件，读取失败按空内容跳过
    const content = await io.readText(rel).catch(() => "");
    if (content) writes.push({ path: `books/${bookId}/${rel}`, content });
  }
  const shelf = await config.getBookshelf();
  const meta = shelf.find((item) => item.id === bookId);
  for (let offset = 0; offset < writes.length; offset += BATCH_LIMIT) {
    const response = await post("/api/internal/sync", { book: bookId, owner: meta?.ownerId ?? "", writes: writes.slice(offset, offset + BATCH_LIMIT), deletes: [] });
    if (!response.ok) throw new Error(`edge sync failed: ${response.status}`);
  }
  const bookshelf = await new FileIO(root).readText("bookshelf.json");
  if (bookshelf) {
    const response = await post("/api/internal/sync", { writes: [{ path: "platform/bookshelf.json", content: bookshelf }], deletes: [] });
    if (!response.ok) throw new Error(`edge sync bookshelf failed: ${response.status}`);
  }
  return { pushed: writes.length };
}

async function walk(io: FileIO, rel: string): Promise<string[]> {
  const names = await io.listDir(rel);
  const files: string[] = [];
  for (const name of names) {
    const child = rel === "." ? name : `${rel}/${name}`;
    // 用 isDir 区分文件与目录：listDir 对文件也返回 []，旧判据会让文件永不入列
    if (await io.isDir(child)) files.push(...(await walk(io, child)));
    else files.push(child);
  }
  return files;
}

async function post(pathname: string, payload: unknown): Promise<{ ok: boolean; status: number }> {
  const base = options?.url ?? "";
  const token = options?.token ?? "";
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}${pathname}`, { method: "POST", headers: { "content-type": "application/json", "x-internal-token": token }, body: JSON.stringify(payload) });
    return { ok: response.ok, status: response.status };
  } catch { return { ok: false, status: 0 }; }
}

function resolveDir(dir: string): string {
  const parts = dir.replace(/\\/g, "/").split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return `/${stack.join("/")}`;
}

function relativeUnder(root: string, dir: string): string | null {
  if (dir === root) return ".";
  if (dir.startsWith(`${root}/`)) return dir.slice(root.length + 1);
  return null;
}
