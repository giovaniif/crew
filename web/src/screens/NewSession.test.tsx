import { readFileSync } from "node:fs";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App, type AppEnv } from "../App";
import { FakeServer, MemoryStorage } from "../test/fake-server";
import { FakeSockets } from "../test/fake-socket";
import { pick } from "../test/pick";

const golden = (name: string) => JSON.parse(readFileSync(new URL("../../../internal/serve/testdata/" + name, import.meta.url), "utf8"));
const device = { id: "k3m9p2qx", name: "iPhone", created_at: "2026-10-03T10:00:00Z", last_seen: "2026-10-03T10:00:00Z" };
const workspaces = {
  workspaces: [
    { Root: "/home/me/api", Kind: "single", Repos: [], LastUsed: "2026-10-03T12:00:00Z" },
    { Root: "/home/me/web", Kind: "single", Repos: [], LastUsed: "2026-10-01T12:00:00Z" },
  ],
  last_used: "/home/me/api",
};
const resolveURL = (workspace: string, item: string) => "/api/v1/work-items/resolve?" + new URLSearchParams({ workspace, item }).toString();

function setup(options: { remembered?: unknown; workspacesDown?: boolean; routes?: (s: FakeServer) => void } = {}) {
  window.location.hash = "#/new";
  const sockets = new FakeSockets();
  const storage = new MemoryStorage();
  storage.setItem("crew.auth", JSON.stringify({ token: "t0k", device }));
  if (options.remembered) {
    storage.setItem("crew.new", JSON.stringify(options.remembered));
  }
  const server = new FakeServer()
    .on("GET", "/api/v1/hello", { status: 200, body: { api: "v1", build: "v0.12.0+abc" } })
    .on("GET", "/api/v1/session-options", { status: 200, body: golden("session-options.json") })
    .on("GET", "/api/v1/workspaces", options.workspacesDown ? { status: 503, body: { error: { code: "unavailable", message: "daemon is down" } } } : { status: 200, body: workspaces });
  const env: AppEnv = {
    fetch: server.fetch,
    storage,
    installed: true,
    hash: "#/new",
    host: "crew.example.ts.net",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    openStream: sockets.open,
    retryDelay: () => 5,
    now: () => 0,
    onHashChange: (cb) => {
      const listener = () => cb(window.location.hash);
      window.addEventListener("hashchange", listener);
      return () => window.removeEventListener("hashchange", listener);
    },
  };
  options.routes?.(server);
  render(<App env={env} />);
  return { server, storage, sockets };
}

beforeEach(() => {
  window.location.hash = "";
});

afterEach(() => {
  window.location.hash = "";
});

describe("starting a session from the phone", () => {
  it("opens from a New session link on the session list", async () => {
    window.location.hash = "";
    const sockets = new FakeSockets();
    const storage = new MemoryStorage();
    storage.setItem("crew.auth", JSON.stringify({ token: "t0k", device }));
    const server = new FakeServer().on("GET", "/api/v1/workspaces", { status: 200, body: workspaces });
    render(
      <App
        env={{
          fetch: server.fetch,
          storage,
          installed: true,
          hash: "#/sessions",
          host: "h",
          userAgent: "",
          openStream: sockets.open,
          now: () => 0,
          onHashChange: (cb) => {
            const listener = () => cb(window.location.hash);
            window.addEventListener("hashchange", listener);
            return () => window.removeEventListener("hashchange", listener);
          },
        }}
      />,
    );
    const link = screen.getByRole("link", { name: "New session" });
    expect(link).toHaveAttribute("href", "#/new");
    await userEvent.click(link);
    expect(await screen.findByRole("heading", { name: "What should the agent do?" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sessions" })).toHaveAttribute("href", "#/sessions");
  });

  it("asks to trust the project for Claude before it starts, and trusts it", async () => {
    let trusted = false;
    const { server } = setup({
      routes: (s) =>
        void s
          .on("GET", "/api/v1/claude/trust?path=%2Fhome%2Fme%2Fapi", () => ({ status: 200, body: { path: "/home/me/api", trusted } }))
          .on("POST", "/api/v1/claude/trust", () => ((trusted = true), { status: 200, body: { path: "/home/me/api", trusted: true } })),
    });
    const ask = await screen.findByRole("alert", { name: "Trust api for Claude?" });
    expect(ask).toHaveTextContent("Trust api for Claude? Claude asks one time for each folder. If you do not trust it, Claude stops at the first message.");
    await userEvent.type(screen.getByRole("textbox", { name: "Task" }), "TEST fix the build");
    expect(screen.getByRole("button", { name: "Start session" })).toBeDisabled();
    await userEvent.click(within(ask).getByRole("button", { name: "Trust" }));
    await waitFor(() => expect(screen.queryByRole("alert", { name: "Trust api for Claude?" })).not.toBeInTheDocument());
    expect(server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/claude/trust")?.body).toEqual({ path: "/home/me/api" });
    expect(screen.getByRole("button", { name: "Start session" })).toBeEnabled();
  });

  it("does not ask for trust when the server can not tell it", async () => {
    setup();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent("api"));
    expect(screen.queryByRole("alert", { name: /for Claude/ })).not.toBeInTheDocument();
  });

  it("offers to set up the Claude hooks when crew never set them up", async () => {
    let fixed = false;
    const { server } = setup({ routes: (s) => void s
      .on("GET", "/api/v1/hooks", () => ({ status: 200, body: { missing: fixed ? [] : [{ env: "local", harness: "claude", file: "/home/me/.claude/settings.json", reason: "crew hooks are not set up in ~/.claude/settings.json", new: true }] } }))
      .on("POST", "/api/v1/hooks/fix", () => ((fixed = true), { status: 200, body: { missing: [] } })) });
    const alert = await screen.findByRole("alert", { name: "Claude hooks" });
    expect(alert).toHaveTextContent("crew hooks are not set up in ~/.claude/settings.json. Without them, crew can not see what Claude does.");
    await userEvent.click(within(alert).getByRole("button", { name: "Set up" }));
    await waitFor(() => expect(screen.queryByRole("alert", { name: "Claude hooks" })).not.toBeInTheDocument());
    expect(server.calls.find((c) => c.path === "/api/v1/hooks/fix")?.body).toEqual({ env: "local", harness: "claude" });
  });

  it("defaults to the daemon's last used project, Claude, and no model or effort", async () => {
    const { server } = setup();
    const project = await screen.findByRole("combobox", { name: "Project" });
    await waitFor(() => expect(project).toHaveTextContent("api"));
    expect(screen.getByRole("combobox", { name: "Agent" })).toHaveTextContent("Claude · default (opus)");
    expect(screen.getByRole("combobox", { name: "Effort" })).toHaveTextContent("effort default (high)");
    expect(screen.getByRole("button", { name: "Start session" })).toBeEnabled();
    expect(new Set(server.headers.map((h) => h.authorization))).toEqual(new Set(["Bearer t0k"]));
  });

  it("defaults to what this device used last", async () => {
    setup({ remembered: { workspace: "/home/me/web", harness: "codex", model: "gpt-5.5", effort: "high" } });
    const project = await screen.findByRole("combobox", { name: "Project" });
    await waitFor(() => expect(project).toHaveTextContent("web"));
    expect(screen.getByRole("combobox", { name: "Agent" })).toHaveTextContent("Codex · gpt-5.5");
    expect(screen.getByRole("combobox", { name: "Effort" })).toHaveTextContent("effort high");
  });

  it("keeps a remembered model that is not in the list", async () => {
    setup({ remembered: { workspace: "/home/me/api", harness: "claude", model: "opus-next", effort: "" } });
    expect(await screen.findByRole("combobox", { name: "Agent" })).toHaveTextContent("Claude · opus-next");
  });

  it("falls back to the last used project when the remembered one is gone", async () => {
    setup({ remembered: { workspace: "/home/me/gone", harness: "claude", model: "", effort: "" } });
    const project = await screen.findByRole("combobox", { name: "Project" });
    await waitFor(() => expect(project).toHaveTextContent("api"));
  });

  it("asks one question and says that the choices are remembered", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "What should the agent do?" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Task" })).toHaveAttribute("placeholder", "Describe the task, or paste a PR or issue URL");
    expect(screen.getByTestId("new-hint")).toHaveTextContent("Enter start · project, agent and effort are remembered from your last session");
  });

  it("offers each agent with its models and a default", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("combobox", { name: "Agent" }));
    for (const name of ["Claude · default (opus)", "Claude · sonnet", "Codex · default", "Codex · gpt-5.5"]) {
      expect(screen.getByRole("option", { name })).toBeInTheDocument();
    }
  });

  it("shows the resolved title and worktree name of a work item on one line", async () => {
    const { server } = setup();
    server.on("GET", resolveURL("/home/me/api", "ENG-12"), { status: 200, body: golden("work-item-resolved.json") });
    await userEvent.type(await screen.findByRole("textbox", { name: "Task" }), "ENG-12");
    const line = await screen.findByTestId("resolution-line");
    await waitFor(() => expect(line).toHaveTextContent("Fix the login redirect → new worktree api-12"));
    expect(screen.getByRole("button", { name: "Start session" })).toBeEnabled();
  });

  it("says a folder with no git runs in place and promises no worktree", async () => {
    const { server } = setup();
    server.on("GET", resolveURL("/home/me/api", "What can you do?"), {
      status: 200,
      body: { source: "text", title: "What can you do?", worktree: "", workspace: "/home/me/api", dir: "/home/me/api", git: false },
    });
    await userEvent.type(await screen.findByRole("textbox", { name: "Task" }), "What can you do?");
    const line = await screen.findByTestId("resolution-line");
    await waitFor(() => expect(line).toHaveTextContent("What can you do? → runs in ~/api (not a git repo, no worktree)"));
    expect(line).not.toHaveTextContent("new worktree");
    expect(screen.getByRole("button", { name: "Start session" })).toBeEnabled();
  });

  it("reports a bad work item and does not allow the launch", async () => {
    const { server } = setup();
    const url = "https://example.com/x";
    server.on("GET", resolveURL("/home/me/api", url), { status: 400, body: golden("work-item-bad.json") });
    await userEvent.type(await screen.findByRole("textbox", { name: "Task" }), url);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("unsupported link: use a GitHub pull request URL");
    expect(screen.getByRole("button", { name: "Start session" })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "Task" }), "{Enter}");
    expect(server.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("starts with Enter, sends the first line as the task and the text as the prompt, remembers the chips and opens the session", async () => {
    const { server, storage } = setup();
    server.on("GET", resolveURL("/home/me/web", "ENG-12"), { status: 200, body: golden("work-item-resolved.json") });
    server.on("POST", "/api/v1/sessions", { status: 200, body: golden("session-new.json") });
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent("api"));
    await pick(user, screen.getByRole("combobox", { name: "Project" }), /^web/);
    await pick(user, screen.getByRole("combobox", { name: "Agent" }), "Codex · gpt-5.5");
    await pick(user, screen.getByRole("combobox", { name: "Effort" }), "effort high");
    await user.type(screen.getByRole("textbox", { name: "Task" }), "ENG-12{Shift>}{Enter}{/Shift}start with the tests");
    expect(server.calls.some((c) => c.method === "POST")).toBe(false);
    await user.type(screen.getByRole("textbox", { name: "Task" }), "{Enter}");
    await waitFor(() => expect(window.location.hash).toBe("#/sessions/s9"));
    expect(server.calls.find((c) => c.method === "POST")?.body).toEqual({
      workspace: "/home/me/web",
      work_item: "ENG-12",
      harness: "codex",
      model: "gpt-5.5",
      effort: "high",
      prompt: "ENG-12\nstart with the tests",
    });
    expect(JSON.parse(storage.getItem("crew.new") ?? "{}")).toEqual({
      workspace: "/home/me/web",
      harness: "codex",
      model: "gpt-5.5",
      effort: "high",
    });
  });

  it("sends a PR or issue URL as the work item only", async () => {
    const { server } = setup();
    const url = "https://github.com/acme/api/pull/12";
    server.on("GET", resolveURL("/home/me/api", url), { status: 200, body: golden("work-item-resolved.json") });
    server.on("POST", "/api/v1/sessions", { status: 200, body: golden("session-new.json") });
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent("api"));
    await user.type(screen.getByRole("textbox", { name: "Task" }), url);
    await user.click(screen.getByRole("button", { name: "Start session" }));
    await waitFor(() => expect(window.location.hash).toBe("#/sessions/s9"));
    expect(server.calls.find((c) => c.method === "POST")?.body).toEqual({ workspace: "/home/me/api", work_item: url, harness: "claude" });
  });

  it("shows a setup recipe's output when the launch fails", async () => {
    const { server } = setup();
    server.on("GET", resolveURL("/home/me/api", "tidy"), { status: 200, body: { source: "text", title: "tidy", worktree: "tidy", workspace: "/home/me/api" } });
    server.on("POST", "/api/v1/sessions", { status: 500, body: golden("session-new-failed.json") });
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent("api"));
    await user.type(screen.getByRole("textbox", { name: "Task" }), "tidy");
    await user.click(screen.getByRole("button", { name: "Start session" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("setup /w/api: npm ci: exit status 1");
    expect(alert).toHaveTextContent("npm ERR! missing lockfile");
    expect(window.location.hash).toBe("#/new");
    expect(screen.getByRole("button", { name: "Start session" })).toBeEnabled();
  });

  it("reloads the workspaces when Retry now is pressed after they failed to load", async () => {
    const { server } = setup({ workspacesDown: true });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load workspaces: daemon is down");
    server.on("GET", "/api/v1/workspaces", { status: 200, body: workspaces });
    await userEvent.click(screen.getByRole("button", { name: "Retry now" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent("api"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("managing workspaces from the phone", () => {
  it("adds a workspace from a path with ~ and selects it", async () => {
    const { server } = setup();
    server.on("POST", "/api/v1/workspaces", { status: 200, body: { Root: "/home/me/docs", Kind: "single", Repos: [] } });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent("api"));
    server.on("GET", "/api/v1/workspaces", {
      status: 200,
      body: { workspaces: [...workspaces.workspaces, { Root: "/home/me/docs", Kind: "single", Repos: [], LastUsed: "0001-01-01T00:00:00Z" }], last_used: "/home/me/api" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Add workspace…" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Folder on the server" }), "~/docs");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/workspaces")?.body).toEqual({ path: "/home/me/docs" });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent("docs"));
  });

  it("shows why the server refused a folder", async () => {
    const { server } = setup();
    server.on("POST", "/api/v1/workspaces", { status: 400, body: { error: { code: "bad_request", message: "/home/me/nope is not a directory" } } });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent("api"));
    await userEvent.click(screen.getByRole("button", { name: "Add workspace…" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Folder on the server" }), "/home/me/nope");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("/home/me/nope is not a directory")).toBeInTheDocument();
  });

  it("shows the remove workspace confirm with a secondary Cancel and a danger Remove", async () => {
    setup();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent("api"));
    await userEvent.click(screen.getByRole("button", { name: "Remove workspace" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveClass("secondary");
    expect(within(dialog).getByRole("button", { name: "Remove /home/me/api" })).toHaveClass("danger");
  });

  it("removes the selected workspace only after a confirmation that no files change", async () => {
    const { server } = setup();
    server.on("POST", "/api/v1/workspaces/remove", { status: 200, body: {} });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent("api"));
    await userEvent.click(screen.getByRole("button", { name: "Remove workspace" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("No files, worktrees or branches on the server change.");
    expect(server.calls.some((c) => c.path === "/api/v1/workspaces/remove")).toBe(false);
    server.on("GET", "/api/v1/workspaces", { status: 200, body: { workspaces: [workspaces.workspaces[1]], last_used: "" } });
    await userEvent.click(screen.getByRole("button", { name: "Remove /home/me/api" }));
    expect(server.calls.find((c) => c.path === "/api/v1/workspaces/remove")?.body).toEqual({ root: "/home/me/api" });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent("web"));
  });
});
