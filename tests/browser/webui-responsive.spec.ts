import { expect, test, type Locator, type Page } from "@playwright/test";
import { validateModelSetInput } from "../../src/web/providers/modelConfig.js";
import { normalizePlatformModelCapabilities } from "../../src/models/capabilities.js";

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

const modelSetInput = {
  name: "主力模型",
  agents: { writer: { provider: "openai", model: "gpt-5", parameters: { temperature: 0.4 } } },
};

const providerCatalog = [{ provider: "openai", models: [{ model: "gpt-5", capabilities: { contextWindow: 128000, maxOutputTokens: 16384 } }], credentials: [] }];

const modelConfiguration = {
  activeModelSetId: "set-1",
  modelSets: [{ id: "set-1", version: 2, ...modelSetInput }],
  providers: providerCatalog,
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

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

async function installProjectRoutes(page: Page, longContent = false) {
  expect(() => validateModelSetInput(modelSetInput, {
    credentials: [],
    platformModels: providerCatalog.flatMap(({ provider, models }) => models.map(({ model, capabilities: caps }) => ({
      provider, model,
      capabilities: normalizePlatformModelCapabilities(caps ?? { contextWindow: 128000, maxOutputTokens: 16384 }),
    }))),
  })).not.toThrow();
  await page.route("**/api/projects/", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ projects: [project] }) });
  });
  await page.route(`**/api/projects/${project.id}/workbench`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ workbench: {
      ...project,
       chapters: [{ id: "chapter-1", runId: null, sequence: 1, title: longContent ? "一段足够长且没有空格的章节标题ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" : "潮声抵达前", status: "draft", body: "她在码头读完了第一封信。", version: 1 }],
       latestRun: longContent ? { id: "11111111-1111-4111-8111-111111111111", status: "running" } : null,
       agents: longContent ? [{ name: "WriterAgentWithAnExtremelyLongUnbrokenNameABCDEFGHIJKLMNOPQRSTUVWXYZ", state: "failed", summary: "诊断文本ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" }] : [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: "0.00000000", byAgent: [] }, pendingQuestion: null,
      modelConfiguration,
    } }) });
  });
}

test("mobile long content and short viewport stay contained", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 480 });
  await installProjectRoutes(page, true);
  await page.goto(`/projects/${project.id}?panel=writing&chapter=chapter-1`, { waitUntil: "domcontentloaded" });

  const topbarTitle = page.locator(".workbench-topbar p");
  await expect(topbarTitle).toBeVisible();
  await expect(topbarTitle).toContainText("一段足够长");
  await expectInsideViewport(page, topbarTitle);
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "运行", exact: true }).click();
  await expect(page.getByText("WriterAgentWithAnExtremelyLongUnbrokenNameABCDEFGHIJKLMNOPQRSTUVWXYZ")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectInsideViewport(page, page.getByRole("navigation", { name: "创作台区域" }));
});

test("tablet run drawer preserves form state and pending lock across close and reopen", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await installProjectRoutes(page);
  let finishRun!: () => void;
  const runFinished = new Promise<void>((resolve) => { finishRun = resolve; });
  await page.route(`**/api/projects/${project.id}/runs`, async (route) => {
    await runFinished;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ run: { id: "22222222-2222-4222-8222-222222222222" } }) });
  });
  await page.goto(`/projects/${project.id}?panel=writing&chapter=chapter-1`, { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "打开运行状态" }).click();
  await page.getByRole("combobox", { name: "模型集" }).selectOption("set-1");
  await page.getByRole("button", { name: "启动运行" }).click();
  await expect(page.getByRole("button", { name: "正在启动" })).toBeDisabled();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "打开运行状态" }).click();

  await expect(page.getByRole("combobox", { name: "模型集" })).toHaveValue("set-1");
  await expect(page.getByRole("button", { name: "正在启动" })).toBeDisabled();
  expect(await page.locator(".run-sidebar").count()).toBe(1);
  finishRun();
});

test("responsive mode changes focus the visible primary region", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await installProjectRoutes(page);
  await page.goto(`/projects/${project.id}?panel=project&chapter=chapter-1`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("complementary", { name: "作品结构" })).toBeVisible();

  await page.setViewportSize({ width: 1024, height: 700 });
  await expect(page.getByRole("main")).toBeFocused();
  await page.setViewportSize({ width: 375, height: 700 });
  await expect(page.getByRole("complementary", { name: "作品结构" })).toBeFocused();
});

test("mobile writing exposes connection and operation errors with a run entry", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await installProjectRoutes(page, true);
  await page.route(`**/api/projects/${project.id}/runs/*/pause`, async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", headers: { "x-request-id": "request-with-a-very-long-identifier" }, body: JSON.stringify({ error: { kind: "request", message: "failed" } }) });
  });
  await page.goto(`/projects/${project.id}?panel=writing&chapter=chapter-1`, { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "运行", exact: true }).click();
  await page.getByRole("button", { name: "暂停运行" }).click();
  await expect(page.getByRole("alert")).toContainText("request-with-a-very-long-identifier");
  await page.getByRole("button", { name: "创作" }).click();
  const errorEntry = page.getByRole("button", { name: /查看运行错误/ });
  await expect(errorEntry).toContainText("request-with-a-very-long-identifier");
  await errorEntry.click();
  await expect(page.getByRole("button", { name: "运行", exact: true })).toHaveAttribute("aria-current", "page");
});

for (const width of [375, 768, 1024, 1200, 1440, 1920]) {
  test(`project library stays reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await installProjectRoutes(page);
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

  test(`creative workbench uses the correct layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await installProjectRoutes(page);
    await page.goto(`/projects/${project.id}?panel=writing&chapter=chapter-1`, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "创作流" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    if (width < 768) {
      await expect(page.getByRole("navigation", { name: "创作台区域" })).toBeVisible();
      await expect(page.getByRole("button", { name: "创作" })).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("button", { name: "打开章节目录" })).toBeHidden();
      await expect(page.locator(".manuscript-page")).toHaveCSS("border-radius", "0px");
      await expect(page.locator(".mobile-composer")).toHaveCSS("z-index", "10");
      await expect(page.getByRole("button", { name: "创作" })).toHaveCSS("border-radius", "0px");
      const composerBox = await page.locator(".prompt-input").boundingBox();
      const navigationBox = await page.getByRole("navigation", { name: "创作台区域" }).boundingBox();
      expect(composerBox).not.toBeNull();
      expect(navigationBox).not.toBeNull();
      expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(navigationBox!.y + 1);
    } else if (width < 1200) {
      const writingCanvas = page.locator(".writing-column");
      const canvasWidth = (await writingCanvas.boundingBox())?.width;
      const chapterTrigger = page.getByRole("button", { name: "打开章节目录" });
      await expect(chapterTrigger).toBeVisible();
      await chapterTrigger.click();
      await expectInsideViewport(page, page.getByRole("dialog", { name: "章节目录" }));
      await expect(page.getByRole("dialog", { name: "章节目录" })).toHaveCSS("box-shadow", /rgba/);
      await expectNoHorizontalOverflow(page);
      expect(Math.abs(((await writingCanvas.boundingBox())?.width ?? 0) - (canvasWidth ?? 0))).toBeLessThanOrEqual(1);
      await page.keyboard.press("Escape");
      await expect(chapterTrigger).toBeFocused();
    } else {
      await expect(page.getByRole("complementary", { name: "作品结构" })).toBeVisible();
      await expect(page.getByRole("complementary", { name: "运行状态" })).toBeVisible();
      await expect(page.getByRole("button", { name: "布局" })).toHaveCount(0);
      await expect(page.locator(".studio-topbar")).toHaveCSS("background-color", "rgb(33, 27, 43)");
      await expect(page.locator(".manuscript-page")).toHaveCSS("background-color", "rgb(255, 253, 248)");
      await expect(page.locator(".chapter-current")).toHaveCSS("position", "relative");
      const projectBox = await page.getByRole("complementary", { name: "作品结构" }).boundingBox();
      const statusBox = await page.getByRole("complementary", { name: "运行状态" }).boundingBox();
      expect(projectBox?.width).toBeGreaterThanOrEqual(250);
      expect(projectBox?.width).toBeLessThanOrEqual(262);
      expect(statusBox?.width).toBeGreaterThanOrEqual(314);
      expect(statusBox?.width).toBeLessThanOrEqual(326);
    }

    const modelSet = page.getByRole("combobox", { name: "模型集" });
    const createRun = page.getByRole("button", { name: "启动运行" });
    if (width < 768) {
      await page.getByRole("button", { name: "运行", exact: true }).click();
      await expect(modelSet).toBeVisible();
      await expectNoHorizontalOverflow(page);
    } else if (width < 1200) {
      await page.getByRole("button", { name: "打开运行状态" }).click();
      await expect(page.getByRole("dialog", { name: "运行状态" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
    await expect(modelSet).toBeVisible();
    await expect(createRun).toBeVisible();
    expect((await modelSet.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
    expect((await createRun.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
    await modelSet.selectOption("set-1");
    await expect(createRun).toBeEnabled();
    await createRun.scrollIntoViewIfNeeded();
    const scrollState = await createRun.evaluate((button) => {
      let scrollingElement = button.parentElement;
      while (scrollingElement) {
        const { overflowY } = getComputedStyle(scrollingElement);
        if (overflowY === "auto" || overflowY === "scroll") break;
        scrollingElement = scrollingElement.parentElement;
      }
      const buttonRect = button.getBoundingClientRect();
      const sidebarRect = scrollingElement?.getBoundingClientRect();
      return {
        className: scrollingElement?.className ?? "",
        bottomGap: sidebarRect ? sidebarRect.bottom - buttonRect.bottom : -1,
      };
    });
    expect(scrollState.className).toContain("run-sidebar");
    expect(scrollState.bottomGap).toBeGreaterThanOrEqual(16);
  });
}
