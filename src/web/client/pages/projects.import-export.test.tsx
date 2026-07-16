// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectsPage, type Project } from "./projects.js";

const project: Project = { id: "p1", userId: "u1", title: "Novel", status: "active", version: 1, archivedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };

function props(api: Record<string, unknown>, projects = [project]) {
  return { api: api as never, projects, error: null, logoutError: null, loading: false, onProjectsChange: vi.fn(), onReload: vi.fn(), onLogout: vi.fn() };
}

describe("ProjectsPage import and export", () => {
  it("announces upload progress and reloads after import", async () => {
    const onReload = vi.fn(async () => undefined);
    const importProject = vi.fn(async (_file: File, progress: (value: number) => void) => { progress(45); return { project: { ...project, id: "p2" }, progress: 100 }; });
    render(<ProjectsPage {...props({ importProject })} onReload={onReload} />);
    const input = screen.getByLabelText("导入作品归档");
    fireEvent.change(input, { target: { files: [new File(["PK"], "novel.sync.zip", { type: "application/zip" })] } });
    expect(await screen.findByText(/导入完成/)).toBeVisible();
    expect(importProject).toHaveBeenCalledOnce();
    expect(onReload).toHaveBeenCalledOnce();
  });

  it("downloads an export and exposes conflict recovery", async () => {
    const exportProject = vi.fn(async () => { throw Object.assign(new Error("conflict"), { kind: "conflict" }); });
    render(<ProjectsPage {...props({ exportProject })} />);
    fireEvent.click(screen.getByRole("button", { name: "导出《Novel》" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/刷新后重试/);
    await waitFor(() => expect(exportProject).toHaveBeenCalledWith("p1"));
  });
});
