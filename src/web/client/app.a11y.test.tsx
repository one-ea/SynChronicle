// @vitest-environment jsdom
import axe from "axe-core";
import { render, screen } from "@testing-library/react";
import { App } from "./app.js";

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
