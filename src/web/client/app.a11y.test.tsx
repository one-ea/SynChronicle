// @vitest-environment jsdom
import axe from "axe-core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./app.js";
import { WorkbenchPage } from "./pages/workbench.js";

it("has no detectable WCAG AA violations on the login page", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  })));
  const { container } = render(<App />);
  await screen.findByRole("heading", { name: "继续你的故事" });

  const result = await axe.run(container, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
  expect(result.violations).toEqual([]);
});

it("has no detectable WCAG AA violations on the creative workbench", async () => {
  const { container } = render(<WorkbenchPage api={{ request: vi.fn().mockResolvedValue({}) }} project={{
    id: "project-1",
    title: "雾港来信",
    chapters: [{ id: "chapter-1", title: "潮声抵达前", sequence: 1, status: "draft", body: "正文" }],
    latestRun: null,
    modelConfiguration: {
      activeModelSetId: "set-1",
      modelSets: [{ id: "set-1", name: "主力模型", version: 2, agents: {} }],
      providers: [],
    },
  }} initialEvents={[]} />);
  await screen.findByRole("heading", { name: "创作流" });
  expect(screen.getByLabelText("模型集")).toHaveAccessibleDescription("选择本次运行使用的模型集。启动后仍可在安全边界切换模型。");
  await userEvent.setup().click(screen.getByRole("button", { name: "布局" }));
  await screen.findByRole("dialog", { name: "布局" });

  const result = await axe.run(container, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
  expect(result.violations).toEqual([]);
});

it("has no detectable WCAG AA violations on the projects page and modal", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ projects: [{
    id: "7ef5fd40-38a7-43dd-856c-b2c074fcf611", userId: "u1", title: "雾港来信", status: "active", version: 1,
    archivedAt: null, createdAt: "2026-07-15T00:00:00.000Z", updatedAt: "2026-07-15T00:00:00.000Z",
  }] }), { status: 200, headers: { "content-type": "application/json" } })));
  const { container } = render(<App />);
  await screen.findByRole("heading", { name: "你的作品" });
  await userEvent.setup().click(screen.getByRole("button", { name: "创建作品" }));
  await screen.findByRole("dialog");

  const result = await axe.run(container, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
  expect(result.violations).toEqual([]);
});
