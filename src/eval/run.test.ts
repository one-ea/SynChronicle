import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runEval, parseTimeout, type EvalHost, type EvalOptions } from "./run.js";
import { Store } from "../store/index.js";

class FakeHost implements EvalHost {
  store: { dir: string };
  startCalls = 0;
  resumeCalls = 0;
  aborted: string[] = [];
  pendingSteerSeen: string | null = null;
  constructor(dir: string, private readonly perStart: number) {
    this.store = { dir };
  }

  async startPrepared(): Promise<void> {
    this.startCalls += 1;
    await this.writeChapters(this.perStart);
  }

  async resume(): Promise<{ label: string | null; error?: Error }> {
    this.resumeCalls += 1;
    const meta = await new Store(this.store.dir).runMeta.load();
    this.pendingSteerSeen = meta?.pending_steer ?? null;
    await this.writeChapters(this.perStart);
    await new Store(this.store.dir).signals.clearPendingCommit();
    const progress = await new Store(this.store.dir).progress.load();
    if (progress?.in_progress_chapter) await new Store(this.store.dir).progress.clearInProgress();
    const refreshedMeta = await new Store(this.store.dir).runMeta.load();
    if (refreshedMeta?.pending_steer) await new Store(this.store.dir).runMeta.save({ ...refreshedMeta, pending_steer: "" });
    return { label: "恢复：从下一章继续" };
  }

  abort(reason: string): void {
    this.aborted.push(reason);
  }

  events() {
    return (async function* () { /* 无事件 */ })();
  }

  stream() {
    return (async function* () { /* 无流 */ })();
  }

  async close(): Promise<void> {}

  private async writeChapters(count: number): Promise<void> {
    const store = new Store(this.store.dir);
    await store.init();
    await this.ensureFoundation(store);
    for (let index = 0; index < count; index += 1) {
      const progress = await store.progress.load();
      const completed = progress?.completed_chapters ?? [];
      const chapter = (completed.at(-1) ?? 0) + 1;
      await store.drafts.saveFinalChapter(chapter, `# 第 ${chapter} 章\n\n正文${chapter}`);
      await store.summaries.saveSummary({ chapter, summary: `s${chapter}`, characters: [], key_events: [] });
      await store.checkpoints.append({ kind: "chapter", chapter }, "plan");
      await store.checkpoints.append({ kind: "chapter", chapter }, "commit", `chapters/${String(chapter).padStart(2, "0")}.md`);
      await store.progress.save({
        novel_name: "B", phase: "writing", current_chapter: chapter + 1, total_chapters: 10,
        completed_chapters: [...completed, chapter], total_word_count: (completed.length + 1) * 1000,
        flow: "writing", in_progress_chapter: 0,
      });
    }
  }

  private async ensureFoundation(store: Store): Promise<void> {
    if (await store.outline.loadPremise()) return;
    await store.outline.savePremise("# 测试小说\n\n一句测试前提。");
    await store.outline.saveOutline(Array.from({ length: 10 }, (_, index) => ({ chapter: index + 1, title: `第${index + 1}章`, core_event: `事件${index + 1}`, hook: `钩子${index + 1}`, scenes: [] })));
    await store.characters.save([{ name: "主角", role: "主角", description: "测试", arc: "成长", traits: [] }]);
    await store.world.saveWorldRules([{ category: "世界", rule: "规则", boundary: "边界" }]);
  }
}

class HungHost extends FakeHost {
  private release: (() => void) | null = null;
  constructor(dir: string) {
    super(dir, 0);
  }
  override async startPrepared(): Promise<void> {
    await new Promise<void>((resolve) => { this.release = resolve; });
    throw new Error("aborted by signal");
  }
  override abort(reason: string): void {
    this.release?.();
    super.abort(reason);
  }
}

function writeCase(dir: string, id: string, body: Record<string, unknown>): string {
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({ id, category: "smoke", prompt: "写一本测试小说", max_chapters: 2, expect: {}, gate: {}, ...body }));
  return dir;
}

function options(overrides: Partial<EvalOptions> = {}): EvalOptions {
  return {
    cases: "",
    variant: "",
    config: "",
    out: "",
    maxChapters: -1,
    timeout: "30m",
    repeat: 1,
    ci: true,
    judge: null,
    ...overrides,
  };
}

async function setup(config = { provider: "mock", model: "mock", providers: { mock: { api_key: "x" } } }) {
  const root = mkdtempSync(join(tmpdir(), "run-eval-"));
  const casesDir = join(root, "cases");
  const configPath = join(root, "config.json");
  const out = join(root, "out");
  mkdirSync(casesDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config));
  return { root, casesDir, configPath, out };
}

describe("runEval", () => {
  it("passes a single case that commits the required chapters", async () => {
    const { casesDir, configPath, out } = await setup();
    writeCase(casesDir, "ok_case", {
      max_chapters: 2,
      expect: { phase: "writing", min_completed_chapters: 2, required_checkpoints: ["chapter:2:commit"] },
    });
    const stderr: string[] = [];
    const code = await runEval(options({ cases: casesDir, config: configPath, out }), {
      stderr: (text) => stderr.push(text),
      now: () => new Date("2026-07-13T12:00:00Z"),
      hostFactory: async (cfg) => new FakeHost(cfg.output_dir!, 2),
    });
    expect(code).toBe(0);
    const md = readFileSync(join(out, "report.md"), "utf8");
    expect(md).toContain("Gate: PASS");
    expect(md).toContain("ok_case（smoke）— PASS");
    expect(stderr.join("")).toContain("ok_case r1 PASS");
  });

  it("fails when the contract is not met and returns exit code 1", async () => {
    const { casesDir, configPath, out } = await setup();
    writeCase(casesDir, "short_case", {
      max_chapters: 3,
      expect: { min_completed_chapters: 3, required_checkpoints: ["chapter:3:commit"] },
    });
    const code = await runEval(options({ cases: casesDir, config: configPath, out }), {
      hostFactory: async (cfg) => new FakeHost(cfg.output_dir!, 1),
    });
    expect(code).toBe(1);
    const md = readFileSync(join(out, "report.md"), "utf8");
    expect(md).toContain("Gate: FAIL");
    expect(md).toContain("contract:min_completed_chapters");
  });

  it("runs recovery in two phases and resumes", async () => {
    const { casesDir, configPath, out } = await setup();
    writeCase(casesDir, "crash_case", {
      category: "recovery",
      expect: { min_completed_chapters: 3, resume_to_chapters: 3, required_checkpoints: ["chapter:3:commit"] },
    });
    const hosts: FakeHost[] = [];
    const code = await runEval(options({ cases: casesDir, config: configPath, out }), {
      hostFactory: async (cfg) => {
        const host = new FakeHost(cfg.output_dir!, 2);
        hosts.push(host);
        return host;
      },
    });
    expect(code).toBe(0);
    const host = hosts[0]!;
    expect(host.startCalls).toBe(1);
    expect(host.resumeCalls).toBe(1);
    const progress = await new Store(host.store.dir).progress.load();
    expect(progress?.completed_chapters).toEqual([1, 2, 3, 4]);
  });

  it("injects pending steer before resume and keeps it visible", async () => {
    const { casesDir, configPath, out } = await setup();
    writeCase(casesDir, "steer_case", {
      category: "steering",
      expect: {
        min_completed_chapters: 3,
        resume_to_chapters: 3,
        steer: { after_chapters: 2, message: "配角动机要更清晰" },
        required_checkpoints: ["chapter:3:commit"],
      },
    });
    const hosts: FakeHost[] = [];
    const code = await runEval(options({ cases: casesDir, config: configPath, out }), {
      hostFactory: async (cfg) => {
        const host = new FakeHost(cfg.output_dir!, 2);
        hosts.push(host);
        return host;
      },
    });
    expect(code).toBe(0);
    expect(hosts[0]!.pendingSteerSeen).toBe("配角动机要更清晰");
  });

  it("seeds in-progress residue before phase one", async () => {
    const { casesDir, configPath, out } = await setup();
    writeCase(casesDir, "seed_case", {
      category: "recovery",
      expect: {
        min_completed_chapters: 2,
        resume_to_chapters: 2,
        seed: { in_progress_chapter: 1, pending_commit: true },
        required_checkpoints: ["chapter:2:commit"],
      },
    });
    const hosts: FakeHost[] = [];
    const code = await runEval(options({ cases: casesDir, config: configPath, out }), {
      hostFactory: async (cfg) => {
        const host = new FakeHost(cfg.output_dir!, 1);
        hosts.push(host);
        return host;
      },
    });
    expect(code).toBe(0);
    const store = new Store(hosts[0]!.store.dir);
    const progress = await store.progress.load();
    expect(progress?.completed_chapters.length).toBeGreaterThanOrEqual(2);
    expect(await store.signals.loadPendingCommit()).toBeNull();

  });

  it("turns a hanging case into a FAIL report via timeout", async () => {
    const { casesDir, configPath, out } = await setup();
    writeCase(casesDir, "hang_case", { max_chapters: 1, expect: { min_completed_chapters: 1 } });
    const code = await runEval(options({ cases: casesDir, config: configPath, out, timeout: "50ms" }), {
      hostFactory: async (cfg) => new HungHost(cfg.output_dir!),
    });
    expect(code).toBe(1);
    const md = readFileSync(join(out, "report.md"), "utf8");
    expect(md).toContain("Gate: FAIL");
    expect(md).toContain("运行时错误: eval: 单 case 超时");
  });

  it("runs A/B with variant override and records judge failure without polluting the gate", async () => {
    const { casesDir, configPath, out } = await setup();
    writeCase(casesDir, "ab_case", {
      max_chapters: 1,
      rubric: "missing_rubric",
      target_prompts: ["writer.md"],
      expect: { min_completed_chapters: 1, required_checkpoints: ["chapter:1:commit"] },
    });
    const variantDir = join(out, "..", "variant");
    mkdirSync(variantDir, { recursive: true });
    writeFileSync(join(variantDir, "writer.md"), "你是作家，遵守以下风格要求：……");
    const code = await runEval(options({ cases: casesDir, config: configPath, out, variant: variantDir, judge: true }), {
      hostFactory: async (cfg) => new FakeHost(cfg.output_dir!, 1),
    });
    // rubric 文件不存在 → judge 失败；但确定性门禁通过 → 不 FAIL
    expect(code).toBe(0);
    const json = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
    expect(json.mode).toBe("ab");
    expect(json.judgeEnabled).toBe(true);
    expect(json.judgeCount).toBe(1);
    expect(json.judgeFailures).toBe(1);
    expect(json.cases[0].judge.ok).toBe(false);
    const md = readFileSync(join(out, "report.md"), "utf8");
    expect(md).toContain("Gate: PASS");
    expect(md).toContain("Judge（失败）");
  });
});

describe("parseTimeout", () => {
  it("parses duration suffixes", () => {
    expect(parseTimeout("30m")).toBe(1_800_000);
    expect(parseTimeout("90s")).toBe(90_000);
    expect(parseTimeout("1h")).toBe(3_600_000);
    expect(parseTimeout("500ms")).toBe(500);
    expect(parseTimeout("10")).toBe(10_000);
  });

  it("rejects invalid values", () => {
    expect(() => parseTimeout("abc")).toThrow(/timeout 非法/);
  });
});
