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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
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
  it("loads a deep-linked workbench from the production projection endpoint", async () => {
    const detail = {
      ...project(),
      chapters: [{ id: "chapter-1", runId: "run-1", sequence: 1, title: "潮声", body: "生产正文", status: "draft", version: 2 }],
      latestRun: null,
      agents: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: "0.00000000", byAgent: [] },
      pendingQuestion: null,
    };
    window.history.replaceState({}, "", `/projects/${detail.id}?chapter=chapter-1`);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ body: { projects: [project()] } }))
      .mockResolvedValueOnce(jsonResponse({ body: { workbench: detail } }));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByText("生产正文")).toBeVisible();
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/projects/${detail.id}/workbench`, expect.anything());
  });

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

  it("keeps the session and offers retry when logout fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ body: { projects: [project()] } }))
      .mockResolvedValueOnce(jsonResponse({ status: 500, body: { error: "Internal Server Error" }, requestId: "req-logout" }))
      .mockResolvedValueOnce(jsonResponse({ status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole("button", { name: "退出登录" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("req-logout");
    expect(screen.getByRole("heading", { name: "你的作品" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "重试退出" }));
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

  it("preserves a concurrently created project when an optimistic rename rolls back", async () => {
    const renameResponse = deferred<Response>();
    const created = project({ id: "25746024-6025-4ad9-916a-29ce50bb3229", title: "并行新作" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ body: { projects: [project()] } }))
      .mockImplementationOnce(() => renameResponse.promise)
      .mockResolvedValueOnce(jsonResponse({ status: 201, body: { project: created } }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole("button", { name: "重命名《雾港来信》" }));
    await user.clear(screen.getByLabelText("新的作品名称"));
    await user.type(screen.getByLabelText("新的作品名称"), "潮汐手稿");
    await user.click(screen.getByRole("button", { name: "保存名称" }));
    await user.click(screen.getByRole("button", { name: "创建作品" }));
    await user.type(screen.getByLabelText("作品名称"), "并行新作");
    await user.click(screen.getByRole("button", { name: "确认创建" }));
    renameResponse.resolve(jsonResponse({ status: 409, body: { error: "Version conflict" } }));

    expect(await screen.findByText("雾港来信")).toBeVisible();
    expect(screen.getByText("并行新作")).toBeVisible();
  });

  it("preserves concurrent list changes when an optimistic archive rolls back", async () => {
    const archiveResponse = deferred<Response>();
    const created = project({ id: "25746024-6025-4ad9-916a-29ce50bb3229", title: "并行新作" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ body: { projects: [project()] } }))
      .mockImplementationOnce(() => archiveResponse.promise)
      .mockResolvedValueOnce(jsonResponse({ status: 201, body: { project: created } }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole("button", { name: "归档《雾港来信》" }));
    await user.click(screen.getByRole("button", { name: "确认归档" }));
    await user.click(screen.getByRole("button", { name: "创建作品" }));
    await user.type(screen.getByLabelText("作品名称"), "并行新作");
    await user.click(screen.getByRole("button", { name: "确认创建" }));
    archiveResponse.resolve(jsonResponse({ status: 500, body: { error: "Internal Server Error" } }));

    expect(await screen.findByText("雾港来信")).toBeVisible();
    expect(screen.getByText("并行新作")).toBeVisible();
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

  it.each([
    [429, "登录尝试过于频繁", "req-rate"],
    [500, "登录服务暂时不可用", "req-login-server"],
  ])("shows a recoverable login message for status %i", async (status, message, requestId) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: 401, body: { error: "Unauthorized" } }))
      .mockResolvedValueOnce(jsonResponse({ status, body: { error: "failure" }, requestId }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await user.type(await screen.findByLabelText("用户名"), "alice");
    await user.type(screen.getByLabelText("密码"), "password");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("alert")).toHaveTextContent(requestId);
    expect(screen.getByRole("button", { name: "重试登录" })).toBeVisible();
  });

  it("shows a recoverable login message for a network failure", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: 401, body: { error: "Unauthorized" } }))
      .mockRejectedValueOnce(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await user.type(await screen.findByLabelText("用户名"), "alice");
    await user.type(screen.getByLabelText("密码"), "password");
    await user.click(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("网络连接失败");
    expect(screen.getByRole("button", { name: "重试登录" })).toBeVisible();
  });

  it("traps focus in a modal, closes with Escape, and restores the trigger", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ body: { projects: [project()] } })));
    const user = userEvent.setup();
    render(<App />);

    const trigger = await screen.findByRole("button", { name: "重命名《雾港来信》" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(document.querySelector(".app-shell")).toHaveAttribute("inert");
    expect(screen.getByLabelText("新的作品名称")).toHaveFocus();
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  }, 30_000);

  it("renders responsive navigation and project actions without viewport-specific duplication", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ body: { projects: [project()] } })));
    window.innerWidth = 375;
    render(<App />);

    expect(await screen.findByRole("navigation", { name: "主导航" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: "重命名《雾港来信》" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "归档《雾港来信》" })).toHaveLength(1);
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
