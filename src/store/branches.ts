import { BranchesManifestSchema, type StoryBranch, type BranchesManifest } from "../domain/branch.js";
import { FileIO } from "./io.js";
import { countWords } from "./versions.js";

const BRANCHES_MANIFEST = "meta/branches.json";
const pad = (n: number) => String(n).padStart(2, "0");

/** 分支 ID 直接拼入文件路径，白名单校验防路径穿越（对齐 staging.ts 的 validateSegment）。 */
function validateBranchId(id: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id) || id.includes("..")) throw new Error(`分支 ID 含非法字符: ${id}`);
}

export class BranchStore {
  constructor(private readonly io: FileIO) {}

  async loadManifest(): Promise<BranchesManifest> {
    const data = await this.io.readJSON<BranchesManifest>(BRANCHES_MANIFEST);
    if (!data) return { branches: [], activeBranchId: undefined };
    const parsed = BranchesManifestSchema.safeParse(data);
    return parsed.success ? parsed.data : { branches: [], activeBranchId: undefined };
  }

  async saveManifest(manifest: BranchesManifest): Promise<void> {
    BranchesManifestSchema.parse(manifest);
    await this.io.writeJSON(BRANCHES_MANIFEST, manifest);
  }

  async createBranch(params: { id: string; name: string; chapter: number; notes?: string; content?: string }): Promise<StoryBranch> {
    validateBranchId(params.id);
    const manifest = await this.loadManifest();
    if (manifest.branches.some((b) => b.id === params.id)) {
      throw new Error(`分支 ID ${params.id} 已存在`);
    }

    // 保存该分支在特定章节的正文副本
    const branchFilePath = `branches/${params.id}/${pad(params.chapter)}.md`;
    const initialText = params.content !== undefined
      ? params.content
      : (await this.io.readText(`chapters/${pad(params.chapter)}.md`)) || "";
    await this.io.writeFile(branchFilePath, initialText);

    const newBranch: StoryBranch = {
      id: params.id,
      name: params.name,
      sourceChapter: params.chapter,
      createdAt: new Date().toISOString(),
      notes: params.notes || "",
      active: false,
    };
    manifest.branches.push(newBranch);
    await this.saveManifest(manifest);
    return newBranch;
  }

  async listBranches(chapter?: number): Promise<StoryBranch[]> {
    const manifest = await this.loadManifest();
    return chapter ? manifest.branches.filter((b) => b.sourceChapter === chapter) : manifest.branches;
  }

  async getBranchContent(branchId: string, chapter: number): Promise<string> {
    validateBranchId(branchId);
    const branchFilePath = `branches/${branchId}/${pad(chapter)}.md`;
    return (await this.io.readText(branchFilePath)) || "";
  }

  async saveBranchContent(branchId: string, chapter: number, content: string): Promise<void> {
    validateBranchId(branchId);
    const branchFilePath = `branches/${branchId}/${pad(chapter)}.md`;
    await this.io.writeFile(branchFilePath, content);
  }

  async mergeBranchToMain(branchId: string, chapter: number): Promise<{ merged: boolean; wordCount: number }> {
    validateBranchId(branchId);
    const content = await this.getBranchContent(branchId, chapter);
    if (!content.trim()) throw new Error(`分支 ${branchId} 第 ${chapter} 章内容为空，无法合并`);
    await this.io.writeFile(`chapters/${pad(chapter)}.md`, content);
    return { merged: true, wordCount: countWords(content) };
  }
}
