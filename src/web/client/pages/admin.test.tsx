// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AdminPage } from "./admin.js";

describe("AdminPage", () => {
  it("updates pricing and confirms disable and delete operations", async () => {
    const request = vi.fn(async (path: string, options?: RequestInit) => {
      if (path === "/api/admin/models" && !options) return { models: [{ id: "11111111-1111-4111-8111-111111111111", provider: "openai", model: "gpt", status: "active", inputPrice: "1", outputPrice: "2", credentialSource: "environment" }] };
      if (options?.method === "PATCH") return { model: { id: "11111111-1111-4111-8111-111111111111", provider: "openai", model: "gpt", status: JSON.parse(String(options.body)).status ?? "active", inputPrice: "3", outputPrice: "4", credentialSource: "environment" } };
      return {};
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "prompt").mockReturnValueOnce("3").mockReturnValueOnce("4");
    render(<AdminPage api={{ request } as never} />);
    await screen.findByText("openai/gpt");
    await userEvent.click(screen.getByRole("button", { name: "修改价格" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining("/models/"), expect.objectContaining({ method: "PATCH" })));
    await userEvent.click(screen.getByRole("button", { name: "停用" }));
    expect(confirm).toHaveBeenCalled();
    await screen.findByRole("button", { name: "删除" });
    await userEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(request).toHaveBeenCalledWith(expect.stringContaining("/models/"), expect.objectContaining({ method: "DELETE" }));
  });
});
