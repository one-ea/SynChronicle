import type { Finding } from "../diag/diagnose.js";
import type { CaseDeltas, MetricDelta } from "./deltas.js";
import type { JudgeRun } from "./judge.js";
import type { CaseMetrics } from "./collect.js";
import type { Outcome } from "./index.js";
import type { StyleStats } from "../stylestat/index.js";

export interface SideReport {
  dir: string;
  metrics: CaseMetrics;
  stylestat: StyleStats | null;
  findings: Finding[];
  checkpoints: string[];
}

export interface CaseReport {
  caseId: string;
  category: string;
  role?: string;
  description?: string;
  mode: "single" | "ab";
  outcome: Outcome;
  hardFails: string[];
  warnings: string[];
  notes: string[];
  passed: string[];
  base: SideReport;
  variant?: SideReport;
  deltas?: CaseDeltas;
  judge?: JudgeRun;
}

export interface RunReport {
  runId: string;
  generatedAt: string;
  mode: "single" | "ab";
  variant: string;
  repeat: number;
  judgeEnabled: boolean;
  judgeCount: number;
  judgeFailures: number;
  gate: Outcome;
  cases: CaseReport[];
}

export interface RenderedReport {
  json: unknown;
  md: string;
}

export function buildReport(report: RunReport): RenderedReport {
  const md = [
    `# SynChronicle Eval Report`,
    ``,
    `- Run: \`${report.runId}\` · ${report.generatedAt}`,
    `- Mode: ${report.mode}${report.variant ? ` · variant: \`${report.variant}\`` : ""} · repeat=${report.repeat}`,
    `- Judge: ${report.judgeEnabled ? `enabled（${report.judgeCount - report.judgeFailures}/${report.judgeCount} 成功）` : "off"}`,
    `- **Gate: ${report.gate}**`,
    ``,
  ];

  for (const c of report.cases) {
    md.push(`## ${c.caseId}（${c.category}${c.role ? `/${c.role}` : ""}）— ${c.outcome}`);
    if (c.description) md.push(``, `> ${c.description}`);
    md.push(``);
    if (c.hardFails.length) {
      md.push(`**Hard Fail:**`);
      for (const fail of c.hardFails) md.push(`- ${fail}`);
      md.push(``);
    }
    if (c.warnings.length) {
      md.push(`**Warnings:**`);
      for (const warning of c.warnings) md.push(`- ${warning}`);
      md.push(``);
    }
    if (c.notes.length) {
      md.push(`Notes:`);
      for (const note of c.notes) md.push(`- ${note}`);
      md.push(``);
    }
    md.push(`**Metrics:**`);
    md.push(``, `| 指标 | baseline | variant | delta |`, `|---|---|---|---|`);
    const base = c.base.metrics;
    if (c.variant) {
      const d = c.deltas;
      const row = (name: string, metric: MetricDelta | undefined) => metric
        ? `| ${name} | ${metric.base} | ${metric.variant} | ${fmtSigned(metric.delta)}${metric.ratio === null ? "（新增）" : ` (${fmtSignedPct(metric.ratio)})`} |`
        : "";
      const rows = [`| completed_chapters | ${base.completedChapters} | ${c.variant.metrics.completedChapters} | ${fmtSigned(c.variant.metrics.completedChapters - base.completedChapters)} |`];
      if (d) {
        rows.push(
          row("tool_calls", d.metrics.toolCalls),
          row("cost_usd", d.metrics.costUsd),
          row("input_tokens", d.metrics.inputTokens),
          row("output_tokens", d.metrics.outputTokens),
          row("critical_findings", d.metrics.criticalFindings),
          row("warning_findings", d.metrics.warningFindings),
        );
      }
      rows.push(`| phase | ${base.phase} | ${c.variant.metrics.phase} | |`);
      md.push(...rows.filter(Boolean));
    } else {
      md.push(
        `| completed_chapters | ${base.completedChapters} | - | |`,
        `| total_words | ${base.totalWords} | - | |`,
        `| phase | ${base.phase} | - | |`,
        `| flow | ${base.flow} | - | |`,
        `| tool_calls | ${base.toolCalls} | - | |`,
        `| cost_usd | ${base.costUsd.toFixed(4)} | - | |`,
        `| chapter_summaries | ${base.chapterSummaries} | - | |`,
        `| arc_summaries | ${base.arcSummaries} | - | |`,
        `| reviews | ${base.reviews} | - | |`,
      );
    }
    md.push(``);

    if (c.variant && c.deltas) {
      const s = c.deltas.stylestat;
      md.push(`**Stylestat（${s.sampleSufficient ? "样本充足" : "样本不足，仅记录"}）:**`);
      md.push(``, `| 指标 | baseline | variant | delta |`, `|---|---|---|---|`);
      const row = (name: string, metric: MetricDelta | null | undefined) => metric
        ? `| ${name} | ${metric.base} | ${metric.variant} | ${fmtSigned(metric.delta)} |`
        : "";
      md.push(
        row("句式模式章均合计", s.patternPerChapter) ?? "",
        row("章末短句占比", s.endingShortRatio) ?? "",
        row("开篇时间词率", s.openingTimeRate) ?? "",
      );
      if (s.titleMixed !== null && s.titleMixed) md.push(`| 标题格式混用 | 无 | 出现 | ⚠ |`);
      md.push(``);
    }

    const stylestat = c.base.stylestat;
    if (stylestat && !c.variant) {
      md.push(`**Stylestat:** 句式模式章均 = ${stylestat.patterns.map(p => `${p.name} ${p.perChapter}`).join("，") || "无"}；章末短句占比 ${stylestat.ending.shortRatio}；开篇时间词率 ${stylestat.openingTimeRate}`, ``);
    }

    if (c.judge) {
      md.push(`**Judge（${c.judge.result ? "成功" : "失败"}）:**`);
      if (c.judge.result) {
        const result = c.judge.result;
        md.push(
          `- winner=${result.winner} · confidence=${result.confidence} · rubric ${result.rubricName} v${result.rubricVersion}（第 ${result.chapter} 章）`,
          `- 七维：${Object.entries(result.scores).map(([key, score]) => `${key} ${score}`).join(" · ")}`,
          ...(result.reasons.length ? [`- reasons: ${result.reasons.map(r => `"${r}"`).join("；")}`] : []),
          ...(result.risks.length ? [`- risks: ${result.risks.map(r => `"${r}"`).join("；")}`] : []),
        );
      } else {
        md.push(`- ${c.judge.error ?? "unknown error"}`);
      }
      md.push(``);
    }

    md.push(`- findings: ${c.base.findings.length}（critical ${c.base.findings.filter(f => f.severity === "critical").length} / warning ${c.base.findings.filter(f => f.severity === "warning").length}）`);
    if (c.variant) {
      md.push(`- variant findings: ${c.variant.findings.length}（critical ${c.variant.findings.filter(f => f.severity === "critical").length} / warning ${c.variant.findings.filter(f => f.severity === "warning").length}）`);
    }
    md.push(`- artifacts: \`${c.base.dir}\`${c.variant ? ` / \`${c.variant.dir}\`` : ""}`, ``);
  }

  if (report.repeat > 1) {
    md.push(`## Repeat 汇总（repeat=${report.repeat}）`, ``);
    const seen = new Set<string>();
    for (const c of report.cases) {
      if (seen.has(c.caseId)) continue;
      seen.add(c.caseId);
      const runs = report.cases.filter(x => x.caseId === c.caseId);
      const passRate = runs.filter(x => x.outcome === "PASS").length;
      const costs = runs.map(x => x.base.metrics.costUsd).sort((a, b) => a - b);
      const calls = runs.map(x => x.base.metrics.toolCalls).sort((a, b) => a - b);
      md.push(
        `- ${c.caseId}: pass_rate ${passRate}/${runs.length}`,
        `  - cost_usd: avg=${avg(costs).toFixed(4)} min=${(costs[0] ?? 0).toFixed(4)} max=${(costs.at(-1) ?? 0).toFixed(4)}`,
        `  - tool_calls: avg=${avg(calls)} min=${calls[0] ?? 0} max=${calls.at(-1) ?? 0}`,
      );
    }
    md.push(``);
  }

  md.push(`---`, ``);
  return { json: report, md: md.join("\n") };
}

function fmtSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function fmtSignedPct(ratio: number): string {
  return `${ratio > 0 ? "+" : ""}${Math.round(ratio * 100)}%`;
}

function avg(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
