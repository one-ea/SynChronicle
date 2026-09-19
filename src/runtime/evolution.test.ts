import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../store/index.js";
import { EvolutionEngine } from "./evolution.js";
describe("EvolutionEngine", () => { it("distills repeated issues, renders experience, and retires ineffective lessons", async () => { const store = new Store(await mkdtemp(join(tmpdir(), "evolution-"))); await store.init(); const engine = new EvolutionEngine(store); await engine.recordChapter({ chapter: 1, golden: 60, aitone: 20, rewrites: 1, reflectionIssues: [{ dimension: "style quality", evidence: "心理独白过长" }] }); await engine.recordChapter({ chapter: 2, golden: 62, aitone: 20, rewrites: 1, reflectionIssues: [{ dimension: "style quality", evidence: "心理独白过长" }] }); expect(await engine.distill()).toHaveLength(1); expect(await engine.renderBlock()).toContain("[进化经验]"); for (let index = 0; index < 4; index += 1) { await engine.renderBlock(); await engine.feedback(index + 3, 60); } expect((await store.evolution.load()).lessons[0]?.status).toBe("retired"); }); });
