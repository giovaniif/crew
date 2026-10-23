import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { desktop, goldenState, session } from "../test/desktop";

afterEach(() => {
  window.location.hash = "";
});

const two = () => ({
  ...goldenState(),
  sessions: [session("s1", "fix the login redirect", { Pane: "%5" }), session("s2", "add retries", { Pane: "%9" })],
  order: undefined,
});

function open(hash = "#/sessions/s1", wide = true) {
  const d = desktop(hash, wide);
  d.server
    .on("POST", "/api/v1/sessions/s1/shell", { status: 200, body: { pane: "%7", dir: "/w/api", shown: true } })
    .on("POST", "/api/v1/sessions/s1/nvim", { status: 200, body: { pane: "%8", socket: "/tmp/nvim.sock", shown: true } })
    .on("POST", "/api/v1/sessions/s2/shell", { status: 200, body: { pane: "%11", dir: "/w/web", shown: true } });
  d.live(two());
  return d;
}

const tab = (name: string) => screen.getByRole("tab", { name });
const panel = (name: string) => screen.getByRole("tabpanel", { name });
const agentScreen = () => screen.getByRole("region", { name: "Agent screen" });
const shellButton = () => screen.getByRole("button", { name: "Shell" });
const posts = (d: ReturnType<typeof open>, path: string) => d.server.calls.filter((c) => c.method === "POST" && c.path === path).length;

describe("the agent screen", () => {
  it("shows the agent pane with the grid size of the terminal", async () => {
    const d = open("#/sessions/s1/agent");
    const socket = d.terminals.socket("%5");
    socket.open();
    expect(socket.frames[0]).toEqual({ token: "t0k", cols: 120, rows: 40 });
    socket.screen("$ make test\r\n");
    socket.output("ok\r\n");
    expect(within(agentScreen()).getByTestId("term-screen")).toHaveTextContent("$ make test ok");
  });

  it("sends typed keys as binary frames, also Ctrl+C and Esc", async () => {
    const d = open("#/sessions/s1/agent");
    const socket = d.terminals.socket("%5");
    socket.open();
    const term = d.terminals.terms[0];
    term.type("ls\r");
    term.type("\u0003");
    term.type("\u001b");
    expect(socket.keys).toEqual(["ls\r", "\u0003", "\u001b"]);
    expect(term.passes({ key: "c", ctrlKey: true })).toBe(true);
    expect(term.passes({ key: "Escape" })).toBe(true);
    expect(term.passes({ key: "t", code: "KeyT", ctrlKey: true })).toBe(true);
    expect(term.passes({ key: "e", code: "KeyE", ctrlKey: true })).toBe(true);
    expect(term.passes({ key: "n", code: "KeyN", ctrlKey: true })).toBe(true);
    expect(term.passes({ key: " ", code: "Space", ctrlKey: true })).toBe(true);
    expect(term.passes({ key: "T", code: "KeyT", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(term.passes({ key: "@", code: "Digit2", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(term.passes({ key: "v", metaKey: true })).toBe(false);
  });

  it("sends the new grid size on each resize", async () => {
    const d = open("#/sessions/s1/agent");
    const socket = d.terminals.socket("%5");
    socket.open();
    d.terminals.terms[0].resize(200, 60);
    expect(socket.frames).toContainEqual({ size: { cols: 200, rows: 60 } });
  });

  it("fits the terminal to its pane when it opens", async () => {
    const d = open("#/sessions/s1/agent");
    expect(d.terminals.terms[0].fits).toBeGreaterThan(0);
  });

  it("keeps the scrollback of each pane when the session changes", async () => {
    const d = open("#/sessions/s1/agent");
    const first = d.terminals.socket("%5");
    first.open();
    first.screen("first session output\r\n");
    window.location.hash = "#/sessions/s2/agent";
    await screen.findByRole("link", { name: /add retries/, current: "page" });
    const second = d.terminals.socket("%9");
    second.open();
    second.screen("second session output\r\n");
    expect(first.closed).toBeNull();
    window.location.hash = "#/sessions/s1/agent";
    await screen.findByRole("link", { name: /fix the login redirect/, current: "page" });
    expect(d.terminals.sockets.filter((s) => s.pane === "%5")).toHaveLength(1);
    expect(within(agentScreen()).getByTestId("term-screen")).toHaveTextContent("first session output");
  });

  it("says when the pane is gone", async () => {
    const d = open("#/sessions/s1/agent");
    d.terminals.socket("%5").drop(4404, "no pane");
    expect(within(agentScreen()).getByRole("status")).toHaveTextContent("This session's pane closed");
  });

  it("explains a closed pane and offers the chat or a new try", async () => {
    const d = open("#/sessions/s1/agent");
    d.terminals.socket("%5").drop(4404, "no pane");
    const state = within(agentScreen()).getByRole("status");
    expect(state).toHaveTextContent("The agent is not running in tmux anymore. Its chat and changes are still here.");
    expect(within(state).getByRole("button", { name: "Open again" })).toBeInTheDocument();
    await userEvent.click(within(agentScreen()).getByRole("button", { name: "Back to chat" }));
    expect(window.location.hash).toBe("#/sessions/s1");
  });

  it("says when tmux is not available", async () => {
    const d = open("#/sessions/s1/agent");
    d.terminals.socket("%5").drop(1013);
    expect(within(agentScreen()).getByRole("status")).toHaveTextContent("tmux is not available");
    await userEvent.click(within(agentScreen()).getByRole("button", { name: "Try again" }));
    expect(d.terminals.sockets.filter((s) => s.pane === "%5")).toHaveLength(2);
  });
});

describe("the shell drawer and the editor", () => {
  it("opens the shell of the session one time and keeps it", async () => {
    const d = open();
    await userEvent.click(shellButton());
    await waitFor(() => expect(d.terminals.socket("%7")).toBeTruthy());
    await userEvent.click(shellButton());
    await userEvent.click(shellButton());
    expect(posts(d, "/api/v1/sessions/s1/shell")).toBe(1);
    expect(d.terminals.sockets.filter((s) => s.pane === "%7")).toHaveLength(1);
  });

  it("toggles nvim only one time, so a second visit does not hide it", async () => {
    const d = open("#/sessions/s1/editor");
    await waitFor(() => expect(d.terminals.socket("%8")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "Close editor" }));
    window.location.hash = "#/sessions/s1/editor";
    await screen.findByRole("region", { name: "Editor" });
    expect(posts(d, "/api/v1/sessions/s1/nvim")).toBe(1);
  });

  it("keeps a shell for each session", async () => {
    const d = open();
    await userEvent.click(shellButton());
    await waitFor(() => expect(d.terminals.socket("%7")).toBeTruthy());
    await userEvent.click(screen.getByRole("link", { name: /add retries/ }));
    await waitFor(() => expect(d.terminals.socket("%11")).toBeTruthy());
    await userEvent.click(screen.getByRole("link", { name: /fix the login redirect/ }));
    expect(posts(d, "/api/v1/sessions/s1/shell")).toBe(1);
    expect(posts(d, "/api/v1/sessions/s2/shell")).toBe(1);
  });

  it("opens the shell drawer with Ctrl+Shift+T and the editor with Ctrl+Shift+E", async () => {
    open();
    await userEvent.keyboard("{Control>}t{/Control}");
    expect(screen.queryByRole("region", { name: "Shell" })).not.toBeInTheDocument();
    await userEvent.keyboard("{Control>}{Shift>}t{/Shift}{/Control}");
    expect(screen.getByRole("region", { name: "Shell" })).toBeInTheDocument();
    await userEvent.keyboard("{Control>}{Shift>}e{/Shift}{/Control}");
    expect(await screen.findByRole("region", { name: "Editor" })).toBeInTheDocument();
  });

  it("opens the shell drawer from the shell route of Disk", async () => {
    const d = open("#/sessions/s1/shell");
    expect(screen.getByRole("region", { name: "Shell" })).toBeInTheDocument();
    await waitFor(() => expect(d.terminals.socket("%7")).toBeTruthy());
  });

  it("passes Ctrl+` to the app, not to the terminal", async () => {
    const d = open("#/sessions/s1/agent");
    d.terminals.socket("%5").open();
    expect(d.terminals.terms[0].passes({ key: "`", code: "Backquote", ctrlKey: true })).toBe(false);
  });
});

describe("the tabs on a phone", () => {
  it("has the same tabs as the desktop and opens the review", async () => {
    const d = open("#/sessions/s1", false);
    const tabs = within(screen.getByRole("tablist", { name: "Views" })).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Chat", "Terminal", "Review", "Shell", "nvim"]);
    await userEvent.click(tab("Review"));
    expect(panel("Review")).toBeInTheDocument();
    await waitFor(() => expect(d.server.calls.some((c) => c.path.startsWith("/api/v1/sessions/s1/review"))).toBe(true));
  });

  it("shows Chat first and opens the terminal of the session", async () => {
    const d = open("#/sessions/s1", false);
    const tabs = within(screen.getByRole("tablist", { name: "Views" })).getAllByRole("tab");
    expect(tabs[0]).toHaveTextContent("Chat");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    await userEvent.click(tab("Terminal"));
    const socket = d.terminals.socket("%5");
    socket.open();
    socket.screen("phone output\r\n");
    expect(within(panel("Terminal")).getByTestId("term-screen")).toHaveTextContent("phone output");
    await userEvent.click(tab("Shell"));
    await waitFor(() => expect(d.terminals.socket("%7")).toBeTruthy());
  });
});
