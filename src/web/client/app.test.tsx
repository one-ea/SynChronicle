// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./app.js";

interface MockResponse {
  status?: number;
  body?: unknown;
  requestId?: string;
}

function jsonResponse({ status = 200, body, requestId = "req-test" }: MockResponse) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-request-id": requestId },
  });
}

const project = (overrides: Record<string, unknown> = {}) => ({
  id: "7ef5fd40-38a7-43dd-856c-b2c074fcf611",
  userId: "user-1",
  title: "雾港来信",
  status: "active",
  version: 1,
  archivedAt: null,
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
  ...overrides,
});

describe("App", () => {
  it("logs in and renders the current user's projects", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: 401, body: { error: "Unauthorized" } }))
      .mockResolvedValueOnce(jsonResponse({ body: { user: { id: "user-1", username: "alice", role: "user" } } }))
      .mockResolvedValueOnce(jsonResponse({ body: { projects: [project()] } }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await user.type(await screen.findByLabelText("用户名"), "alice");
    await user.type(screen.getByLabelText("密码"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByText("雾港来信")).toBeVisible();
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/auth/login", expect.objectContaining({ credentials: "same-origin" }));
    const loginInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const loginHeaders = loginInit.headers as Headers;
    expect(loginHeaders.get("content-type")).toBe("application/json");
    expect(loginHeaders.get("x-request-id")).toEqual(expect.any(String));
  });

  it("restores a cookie session and logs out", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ body: { projects: [project()] } }))
      .mockResolvedValueOnce(jsonResponse({ status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    expect(await screen.findByRole("heading", { name: "你的作品" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "退出登录" }));

    expect(await screen.findByRole("heading", { name: "继续你的故事" })).toBeVisible();
  });

  it("creates, renames, and archives a project", async () => {
    const created = project({ id: "25746024-6025-4ad9-916a-29ce50bb3229", title: "新作", version: 1 });
    const renamed = { ...created, title: "新作修订", version: 2 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ body: { projects: [] } }))
      .mockResolvedValueOnce(jsonResponse({ status: 201, body: { project: created } }))
      .mockResolvedValueOnce(jsonResponse({ body: { project: renamed } }))
      .mockResolvedValueOnce(jsonResponse({ body: { project: { ...renamed, status: "archived", version: 3 } } }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole("button", { name: "创建作品" }));
    await user.type(screen.getByLabelText("作品名称"), "新作");
    await user.click(screen.getByRole("button", { name: "确认创建" }));
    expect(await screen.findByText("新作")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "重命名《新作》" }));
    const titleInput = screen.getByLabelText("新的作品名称");
    await user.clear(titleInput);
    await user.type(titleInput, "新作修订");
    await user.click(screen.getByRole("button", { name: "保存名称" }));
    expect(await screen.findByText("新作修订")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "归档《新作修订》" }));
    await user.click(screen.getByRole("button", { name: "确认归档" }));
    expect(await screen.findByText("这里还没有作品")).toBeVisible();
  });

  it("reverts an optimistic rename and reports a version conflict with request ID", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ body: { projects: [project()] } }))
      .mockResolvedValueOnce(jsonResponse({ status: 409, body: { error: "Version conflict" }, requestId: "req-conflict" }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole("button", { name: "重命名《雾港来信》" }));
    const titleInput = screen.getByLabelText("新的作品名称");
    await user.clear(titleInput);
    await user.type(titleInput, "潮汐手稿");
    await user.click(screen.getByRole("button", { name: "保存名称" }));

    expect(await screen.findByText(/作品已在其他窗口更新/)).toBeVisible();
    expect(screen.getByText(/req-conflict/)).toBeVisible();
    expect(screen.getByText("雾港来信")).toBeVisible();
  });

  it("shows uniform authentication errors and request IDs", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: 401, body: { error: "Unauthorized" } }))
      .mockResolvedValueOnce(jsonResponse({ status: 401, body: { error: "Unauthorized" }, requestId: "req-login" }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await user.type(await screen.findByLabelText("用户名"), "alice");
    await user.type(screen.getByLabelText("密码"), "wrong password");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("用户名或密码不正确");
    expect(screen.getByRole("alert")).toHaveTextContent("req-login");
  });

  it("renders a recoverable project loading error", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: 500, body: { error: "Internal Server Error" }, requestId: "req-load" }))
      .mockResolvedValueOnce(jsonResponse({ body: { projects: [project()] } }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("作品加载失败");
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("雾港来信")).toBeVisible();
  });

  it("keeps the login form keyboard reachable with visible labels", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: 401, body: { error: "Unauthorized" } })));
    render(<App />);

    const username = await screen.findByLabelText("用户名");
    expect(username).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("密码")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByRole("button", { name: "登录" })).toHaveAttribute("type", "submit");
    await waitFor(() => expect(document.activeElement).toBe(username));
  });
});
