import { createHash, randomUUID } from "node:crypto";
import { expect, request as apiRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { createProjectArchive, type ProjectArchiveManifest } from "../src/migration/archive.js";

const password = "correct horse battery staple";
const streamText = "雾港的潮声越过窗沿，信纸上的墨迹仍带着远方的盐味。";

interface FullStackState {
  run: { status: string } | null;
  tasks: Array<{ id: string; status: string; leaseOwner: string | null; leaseVersion: number }>;
  events: Array<{ sequence: number; stableId: string | null; type: string; payload: unknown }>;
  checkpoints: unknown[];
  chapters: Array<{ id: string; runId: string; body: string; version: number }>;
  artifacts: Array<{ id: string; runId: string; type: string; contentText: string | null; contentJson: unknown; version: number }>;
  usage: Array<{ snapshotId: string }>;
  quota: Array<{ id: string }>;
  providerCalls: Array<{ method: string; model: string; workerId?: string }>;
  processes: { worker: { id: string; running: boolean } | null };
}

async function login(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "你的作品" })).toBeVisible();
}

async function state(control: APIRequestContext, runId: string, projectId: string) {
  const response = await control.get(`/state?runId=${encodeURIComponent(runId)}&projectId=${encodeURIComponent(projectId)}`);
  expect(response.status()).toBe(200);
  return response.json() as Promise<FullStackState>;
}

async function waitForState(control: APIRequestContext, runId: string, projectId: string, predicate: (value: FullStackState) => boolean, label: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const value = await state(control, runId, projectId);
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function projectArchive(): Buffer {
  const runId = randomUUID();
  const checkpointId = randomUUID();
  const chapter = Buffer.from("# 潮声抵达前\n\n她在码头读完第一封信。", "utf8");
  const premise = Buffer.from("# 雾港来信\n\n一封跨越潮汐的来信。", "utf8");
  const checksum = (value: Buffer) => createHash("sha256").update(value).digest("hex");
  const manifest: ProjectArchiveManifest = {
    format: "synchronicle-project",
    version: 1,
    project: { title: "导入的雾港来信", version: 1 },
    run: { id: runId, status: "completed", completedAt: "2026-07-16T00:00:00.000Z" },
    checkpoint: { id: checkpointId, version: 1, projectVersion: 1, taskFingerprint: "e2e-import" },
    exportedAt: "2026-07-16T00:00:00.000Z",
    chapters: [{ path: "chapters/01.md", checksum: checksum(chapter), version: 1, sequence: 1, title: "潮声抵达前", status: "complete" }],
    artifacts: [{ path: "planning/premise.md", checksum: checksum(premise), version: 1, type: "premise", status: "committed", encoding: "text" }],
    planning: [{ type: "premise", path: "planning/premise.md", version: 1 }],
    reviews: [],
  };
  return createProjectArchive(manifest, new Map([["chapters/01.md", chapter], ["planning/premise.md", premise]]));
}

test("real Web, database, and Worker execute controls, recovery, and durable output", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const control = await apiRequest.newContext({ baseURL: "http://127.0.0.1:4174" });
  try {
    const processes = await (await control.get("/processes")).json() as FullStackState["processes"];
    if (processes.worker?.running) expect((await control.post("/worker/kill")).status()).toBe(200);
    expect((await control.post("/reset")).status()).toBe(204);
    await login(page, "alice");

  const createdTitle = `归档验证-${testInfo.project.name}`;
  await page.getByRole("button", { name: "创建作品" }).click();
  await page.getByLabel("作品名称").fill(createdTitle);
  await page.getByRole("button", { name: "确认创建" }).click();
  await page.getByRole("button", { name: `归档《${createdTitle}》` }).click();
  await page.getByRole("button", { name: "确认归档" }).click();
  await expect(page.getByRole("link", { name: createdTitle })).toHaveCount(0);

  await page.getByLabel("导入作品归档").setInputFiles({ name: "fixture.sync.zip", mimeType: "application/zip", buffer: projectArchive() });
  await expect(page.getByText("导入完成，作品已加入书架。")).toBeVisible();
  const workflowTitle = `Worker流程-${testInfo.project.name}`;
  await page.getByRole("button", { name: "创建作品" }).click();
  await page.getByLabel("作品名称").fill(workflowTitle);
  await page.getByRole("button", { name: "确认创建" }).click();
  await page.getByRole("link", { name: workflowTitle }).click();
  await expect(page.getByRole("heading", { name: "创作流" })).toBeVisible();
  const projectId = new URL(page.url()).pathname.split("/").at(-1)!;

  if (testInfo.project.name.includes("mobile")) {
    await page.getByRole("button", { name: "状态", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "创作台区域" })).toBeVisible();
  } else {
    await expect(page.getByRole("complementary", { name: "作品结构" })).toBeVisible();
  }

  await page.getByRole("button", { name: "启动运行" }).click();
  await expect(page.getByText(/运行已创建/)).toBeVisible();
  const runId = new URL(page.url()).searchParams.get("run")!;
  expect((await control.post(`/prepare-run?runId=${encodeURIComponent(runId)}&projectId=${encodeURIComponent(projectId)}`)).status()).toBe(201);
  const baseline = await state(control, runId, projectId);
  expect(baseline.chapters).toHaveLength(1);
  expect(baseline.artifacts).toHaveLength(1);
  const taskId = baseline.tasks[0]!.id;
  const baselineChapterIds = new Set(baseline.chapters.map(({ id }) => id));
  const baselineArtifactIds = new Set(baseline.artifacts.map(({ id }) => id));
  expect((await control.post("/worker/start")).status()).toBe(201);
  await waitForState(control, runId, projectId, (value) => value.tasks.some((task) => task.status === "running") && value.providerCalls.some((call) => call.model === "deterministic"), "Worker claim and first Provider call");

  await page.getByLabel("干预指令").fill("增加潮汐带来的紧迫感");
  await page.getByRole("button", { name: "发送" }).click();
  await page.getByLabel("Agent").selectOption("coordinator");
  await page.getByLabel("Provider").selectOption("e2e");
  await page.getByLabel("模型").selectOption("deterministic-v2");
  await page.getByRole("button", { name: "切换模型" }).click();
  await expect(page.getByText("模型切换已排队，将在下一个 Agent 安全边界生效。")).toBeVisible();
  await expect(page.getByText("模型切换已在安全边界应用。")).toBeVisible({ timeout: 15_000 });

  await expect(page.getByRole("heading", { name: "需要你的回答" })).toBeVisible();
  await page.getByLabel("希望写多长？").selectOption("长篇");
  await page.getByRole("button", { name: "提交回答" }).click();
  await page.getByRole("button", { name: "暂停运行" }).click();
  const paused = await waitForState(control, runId, projectId, (value) => value.tasks.some((task) => task.status === "paused") && value.checkpoints.length > 0 && value.providerCalls.some((call) => call.model === "deterministic-v2"), "pause boundary and checkpoint");
  await expect(page.getByText("write")).toBeVisible();

  await page.getByRole("button", { name: "继续运行" }).click();
  const previousProviderCalls = paused.providerCalls.filter((call) => call.model === "deterministic-v2").length;
  const running = await waitForState(control, runId, projectId, (value) => value.tasks.some((task) => task.status === "running" && Boolean(task.leaseOwner)) && value.providerCalls.filter((call) => call.model === "deterministic-v2").length > previousProviderCalls, "resumed Worker execution");
  const leaseVersion = running.tasks[0]!.leaseVersion;
  const previousWorker = running.tasks[0]!.leaseOwner!;
  await page.context().setOffline(true);
  await control.post("/worker/kill");
  await control.post("/worker/start?recovery=1");
  const recovered = await waitForState(control, runId, projectId, (value) => value.tasks.some((task) => task.leaseOwner !== previousWorker && task.leaseVersion > leaseVersion) && value.providerCalls.some((call) => call.workerId !== previousWorker), "lease expiry, reclaim, and Host resume");
  const recoveryWorker = recovered.tasks[0]!.leaseOwner!;
  expect(recovered.processes.worker).toMatchObject({ id: recoveryWorker, running: true });
  const completed = await waitForState(control, runId, projectId, (value) => value.tasks.some((task) => task.status === "completed") && value.chapters.some(({ id, body }) => !baselineChapterIds.has(id) && body.includes(streamText)) && value.artifacts.some(({ id, contentText }) => !baselineArtifactIds.has(id) && contentText?.includes(streamText)), "recovered durable chapter and artifact commit");
  await page.context().setOffline(false);
  await expect(page.getByText(streamText)).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByRole("complementary", { name: "运行状态" })).toContainText("completed", { timeout: 15_000 });
  await page.getByRole("button", { name: /查看章节/ }).first().click();
  await expect(page.locator(".chapter-reader")).toContainText(streamText, { timeout: 15_000 });

  expect(completed.events.map(({ sequence }) => sequence)).toEqual([...completed.events.map(({ sequence }) => sequence)].sort((left, right) => left - right));
  expect(completed.events.map(({ stableId }) => stableId).filter(Boolean)).toHaveLength(new Set(completed.events.map(({ stableId }) => stableId).filter(Boolean)).size);
  expect(completed.events.some(({ type }) => type === "stream.delta")).toBe(true);
  const newChapters = completed.chapters.filter(({ id }) => !baselineChapterIds.has(id));
  const outputArtifacts = completed.artifacts.filter(({ id, contentText }) => !baselineArtifactIds.has(id) && contentText?.includes(streamText));
  const outputStreamEvents = completed.events.filter(({ stableId, payload }) => stableId?.startsWith(`stream:${runId}:${taskId}:`) && JSON.stringify(payload).includes(streamText));
  const completionEvents = completed.events.filter(({ stableId }) => stableId?.endsWith(`/${runId}:completed`));
  expect(newChapters).toEqual([expect.objectContaining({ runId, body: expect.stringContaining(streamText), version: 2 })]);
  expect(outputArtifacts).toEqual([expect.objectContaining({ runId, type: "drafts/01.draft.md", contentText: expect.stringContaining(streamText) })]);
  expect(outputStreamEvents).toHaveLength(1);
  expect(completionEvents).toHaveLength(1);
  expect(completionEvents[0]!.stableId).toContain(runId);
  expect(completed.usage.length).toBeGreaterThan(0);
  expect(completed.usage.map(({ snapshotId }) => snapshotId)).toHaveLength(new Set(completed.usage.map(({ snapshotId }) => snapshotId)).size);
  expect(completed.quota.length).toBeGreaterThan(0);
  expect(completed.providerCalls.some((call) => call.model === "deterministic-v2" && call.workerId === recoveryWorker)).toBe(true);

  await page.goto("/projects");
  const exported = page.waitForResponse((response) => response.url().includes(`/api/projects/${projectId}/export?version=`) && response.status() === 200);
  await page.getByRole("button", { name: `导出《${workflowTitle}》` }).click();
  await exported;

  const bob = await apiRequest.newContext({ baseURL: "http://127.0.0.1:4173", extraHTTPHeaders: { origin: "http://127.0.0.1:4173" } });
  await bob.post("/api/auth/login", { data: { username: "bob", password } });
  expect((await bob.get(`/api/projects/${projectId}`)).status()).toBe(404);
  await bob.dispose();

  await page.getByRole("button", { name: "创建作品" }).click();
  await page.getByLabel("作品名称").fill(`终止验证-${testInfo.project.name}`);
  await page.getByRole("button", { name: "确认创建" }).click();
  await page.getByRole("link", { name: `终止验证-${testInfo.project.name}` }).click();
  const abortProjectId = new URL(page.url()).pathname.split("/").at(-1)!;
  if (testInfo.project.name.includes("mobile")) await page.getByRole("button", { name: "状态", exact: true }).click();
  await page.getByRole("button", { name: "启动运行" }).click();
  const abortRunId = new URL(page.url()).searchParams.get("run")!;
  await expect(page.getByRole("heading", { name: "需要你的回答" })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("希望写多长？").selectOption("长篇");
  await page.getByRole("button", { name: "提交回答" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "终止运行" }).click();
  await expect(page.getByText("终止请求已提交。")).toBeVisible();
    await waitForState(control, abortRunId, abortProjectId, (value) => value.tasks.some((task) => task.status === "cancelled"), "abort boundary");
  } finally {
    await page.context().setOffline(false);
    await control.dispose();
  }
});
