import { expect, test } from "@playwright/test";

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

for (const width of [375, 768, 1024, 1440]) {
  test(`project library remains operable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/projects/", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ projects: [project] }) });
    });
    await page.goto("/projects");

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
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/projects/", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ projects: [project] }) });
    });
    await page.route(`**/api/projects/${project.id}`, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ project: {
        ...project,
        chapters: [{ id: "chapter-1", title: "潮声抵达前", order: 1, status: "draft", body: "她在码头读完了第一封信。" }],
        latestRun: null,
      } }) });
    });
    await page.goto(`/projects/${project.id}?panel=writing&chapter=chapter-1`);

    await expect(page.getByRole("heading", { name: "创作流" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    if (width < 768) {
      await expect(page.getByRole("navigation", { name: "创作台区域" })).toBeVisible();
      await page.getByRole("button", { name: "作品", exact: true }).click();
      await expect(page.getByRole("complementary", { name: "作品结构" })).toBeVisible();
      await page.getByRole("button", { name: "创作", exact: true }).click();
      await expect(page.getByText("她在码头读完了第一封信。")).toBeVisible();
    } else {
      await expect(page.getByRole("complementary", { name: "作品结构" })).toBeVisible();
      await expect(page.getByRole("complementary", { name: "运行状态" })).toBeVisible();
    }
  });
}
