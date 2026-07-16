import { expect, test, type Locator, type Page } from "@playwright/test";

const project = {
  id: "7ef5fd40-38a7-43dd-856c-b2c074fcf611",
  userId: "user-1",
  title: "雾港来信",
  status: "active",
  version: 1,
  archivedAt: null,
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
};

const modelConfiguration = {
  activeModelSetId: "set-1",
  modelSets: [{ id: "set-1", name: "主力模型", version: 2, agents: {} }],
  providers: [],
};

async function expectInsideViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
}

for (const width of [375, 768, 1024, 1440]) {
  test(`project library remains operable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/projects/", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ projects: [project] }) });
    });
    await page.goto("/projects", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "你的作品" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    for (const control of await page.getByRole("button").all()) {
      const box = await control.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test(`creative workbench remains operable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 500 });
    await page.route("**/api/projects/", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ projects: [project] }) });
    });
    await page.route(`**/api/projects/${project.id}/workbench`, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ workbench: {
        ...project,
        chapters: [{ id: "chapter-1", runId: null, sequence: 1, title: "潮声抵达前", status: "draft", body: "她在码头读完了第一封信。", version: 1 }],
        latestRun: null, agents: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: "0.00000000", byAgent: [] }, pendingQuestion: null,
        modelConfiguration,
      } }) });
    });
    await page.goto(`/projects/${project.id}?panel=writing&chapter=chapter-1`, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "创作流" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const layoutTrigger = page.getByRole("button", { name: "布局" });
    if (width <= 768) {
      await expect(layoutTrigger).toBeHidden();
      await expect(page.getByRole("navigation", { name: "创作台区域" })).toBeVisible();
      await page.getByRole("button", { name: "作品", exact: true }).click();
      await expect(page.getByRole("complementary", { name: "作品结构" })).toBeVisible();
      await page.getByRole("button", { name: "创作", exact: true }).click();
      await expect(page.getByText("她在码头读完了第一封信。")).toBeVisible();
      await page.getByRole("button", { name: "状态", exact: true }).click();
    } else {
      await expect(layoutTrigger).toBeVisible();
      await layoutTrigger.click();
      const layoutDialog = page.getByRole("dialog", { name: "布局" });
      await expect(layoutDialog).toBeVisible();
      await expectInsideViewport(page, layoutDialog);
      await expect(page.getByRole("complementary", { name: "作品结构" })).toBeVisible();
      await expect(page.getByRole("complementary", { name: "运行状态" })).toBeVisible();
    }

    const modelSet = page.getByRole("combobox", { name: "模型集" });
    const createRun = page.getByRole("button", { name: "启动运行" });
    await expect(modelSet).toBeVisible();
    await expect(createRun).toBeVisible();
    expect((await modelSet.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
    expect((await createRun.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
    await createRun.scrollIntoViewIfNeeded();
    await expectInsideViewport(page, createRun);
  });
}
