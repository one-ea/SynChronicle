import { readFile } from "node:fs/promises";

if (!process.env.TEST_DATABASE_URL?.trim()) throw new Error("TEST_DATABASE_URL must be set for the CI test gate");
const reportPath = process.argv[2] ?? "vitest-report.json";
const report = JSON.parse(await readFile(reportPath, "utf8")) as { numPendingTests?: number; testResults?: Array<{ assertionResults?: Array<{ status?: string }> }> };
const skipped = report.numPendingTests ?? report.testResults?.flatMap((result) => result.assertionResults ?? []).filter((test) => test.status === "pending").length ?? 0;
if (skipped !== 0) throw new Error(`conditional test gate found ${skipped} skipped tests`);
console.log("Conditional database test gate: 0 skipped tests");
