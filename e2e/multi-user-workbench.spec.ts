import { expect, request as apiRequest, test } from "@playwright/test";

const password = "correct horse battery staple";

async function login(page: import("@playwright/test").Page, username: string) {
  await page.goto("/login");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "你的作品" })).toBeVisible();
}

test("real Web, database, and Worker support the multi-user workbench lifecycle", async ({ page, request }, testInfo) => {
  await login(page, "alice");
  const title = `雾港来信-${testInfo.project.name}`;
  await page.getByRole("button", { name: "创建作品" }).click();
  await page.getByLabel("作品名称").fill(title);
  await page.getByRole("button", { name: "确认创建" }).click();
  await page.getByRole("link", { name: title }).click();
  await expect(page.getByRole("heading", { name: "创作流" })).toBeVisible();

  const projectId = new URL(page.url()).pathname.split("/").at(-1)!;
  if (testInfo.project.name === "mobile") {
    await expect(page.getByRole("navigation", { name: "创作台区域" })).toBeVisible();
    await page.getByRole("button", { name: "状态", exact: true }).click();
  } else {
    await expect(page.getByRole("complementary", { name: "作品结构" })).toBeVisible();
  }

  await page.getByRole("button", { name: "启动运行" }).click();
  await expect(page.getByText(/运行已创建/)).toBeVisible();
  const runId = new URL(page.url()).searchParams.get("run")!;
  const origin = "http://127.0.0.1:4173";
  const post = (path: string, data?: unknown) => request.post(path, { headers: { origin }, ...(data === undefined ? {} : { data }) });
  await expect((await post(`/api/projects/${projectId}/runs/${runId}/pause`)).status()).toBe(200);
  await expect((await post(`/api/projects/${projectId}/runs/${runId}/resume`)).status()).toBe(200);
  await expect((await post(`/api/projects/${projectId}/runs/${runId}/steer`, { commandId: `steer-${testInfo.project.name}`, instruction: "增加潮汐带来的紧迫感" })).status()).toBe(200);
  await expect((await post(`/api/projects/${projectId}/runs/${runId}/answer`, { questionId: "e2e-question", answers: { "故事长度": "长篇" } })).status()).toBe(200);
  await expect((await post(`/api/projects/${projectId}/runs/${runId}/model`, { role: "writer", provider: "e2e", model: "deterministic-v2" })).status()).toBe(200);

  const firstCursor = await page.evaluate(async (id) => new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws/runs/${id}?after=0`);
    const timer = setTimeout(() => reject(new Error("initial WebSocket event timed out")), 10_000);
    socket.onmessage = (message) => {
      const event = JSON.parse(String(message.data)) as { sequence?: number };
      if (typeof event.sequence !== "number") return;
      clearTimeout(timer);
      socket.close();
      resolve(event.sequence);
    };
    socket.onerror = () => reject(new Error("initial WebSocket connection failed"));
  }), runId);
  await post(`/api/projects/${projectId}/runs/${runId}/steer`, { commandId: `replay-${testInfo.project.name}`, instruction: "补充断线期间事件" });
  const replayed = await page.evaluate(async ({ id, after }) => new Promise<number[]>((resolve, reject) => {
    const sequences: number[] = [];
    const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws/runs/${id}?after=${after}`);
    const timer = setTimeout(() => { socket.close(); resolve(sequences); }, 1_000);
    socket.onmessage = (message) => {
      const event = JSON.parse(String(message.data)) as { sequence?: number };
      if (typeof event.sequence === "number") sequences.push(event.sequence);
    };
    socket.onerror = () => { clearTimeout(timer); reject(new Error("replay WebSocket connection failed")); };
  }), { id: runId, after: firstCursor });
  expect(replayed.length).toBeGreaterThan(0);
  expect(replayed).toEqual([...new Set(replayed)].sort((left, right) => left - right));
  expect(replayed.every((sequence) => sequence > firstCursor)).toBe(true);

  const metadata = await request.get(`/api/projects/${projectId}/export-metadata?version=1`);
  expect(metadata.status()).toBe(200);
  const download = await request.get((await metadata.json()).downloadUrl);
  expect(download.status()).toBe(200);
  const archive = await download.body();
  const imported = await request.post("/api/projects/import?filename=copy.sync.zip", { headers: { origin, "content-type": "application/zip" }, data: archive });
  expect(imported.status()).toBe(201);

  const bob = await apiRequest.newContext({ baseURL: origin, extraHTTPHeaders: { origin } });
  await bob.post("/api/auth/login", { data: { username: "bob", password } });
  expect((await bob.get(`/api/projects/${projectId}`)).status()).toBe(404);
  await bob.dispose();

  await expect((await post(`/api/projects/${projectId}/runs/${runId}/abort`)).status()).toBe(200);
  await page.goto("/projects");
  await page.getByRole("button", { name: `归档《${title}》` }).click();
  await page.getByRole("button", { name: "确认归档" }).click();
  await expect(page.getByRole("link", { name: title })).toHaveCount(0);
});
