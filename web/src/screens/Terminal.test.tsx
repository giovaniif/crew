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
const posts = (d: ReturnType<typeof open>, path: string) => d.server.calls.filter((c) => c.method === "POST" && c.path === path).length;

describe("the Terminal tab", () => {
  it("shows the agent pane with the grid size of the terminal", async () => {
    const d = open();
    await userEvent.click(tab("Terminal"));
    const socket = d.terminals.socket("%5");
    socket.open();
    expect(socket.frames[0]).toEqual({ token: "t0k", cols: 120, rows: 40 });
    socket.screen("$ make test\r\n");
    socket.output("ok\r\n");
    expect(within(panel("Terminal")).getByTestId("term-screen")).toHaveTextContent("$ make test ok");
  });

  it("sends typed keys as binary frames, also Ctrl+C and Esc", async () => {
    const d = open();
    await userEvent.click(tab("Terminal"));
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
    const d = open();
    await userEvent.click(tab("Terminal"));
    const socket = d.terminals.socket("%5");
    socket.open();
    d.terminals.terms[0].resize(200, 60);
    expect(socket.frames).toContainEqual({ size: { cols: 200, rows: 60 } });
  });

  it("fits the terminal to its pane when it opens", async () => {
    const d = open();
    await userEvent.click(tab("Terminal"));
    expect(d.terminals.terms[0].fits).toBeGreaterThan(0);
  });

  it("keeps the scrollback of each pane when the session changes", async () => {
    const d = open();
    await userEvent.click(tab("Terminal"));
    const first = d.terminals.socket("%5");
    first.open();
    first.screen("first session output\r\n");
    await userEvent.click(screen.getByRole("link", { name: /add retries/ }));
    const second = d.terminals.socket("%9");
    second.open();
    second.screen("second session output\r\n");
    expect(first.closed).toBeNull();
    await userEvent.click(screen.getByRole("link", { name: /fix the login redirect/ }));
    expect(d.terminals.sockets.filter((s) => s.pane === "%5")).toHaveLength(1);
    expect(within(panel("Terminal")).getByTestId("term-screen")).toHaveTextContent("first session output");
  });

  it("says when the pane is gone", async () => {
    const d = open();
    await userEvent.click(tab("Terminal"));
    d.terminals.socket("%5").drop(4404, "no pane");
    expect(within(panel("Terminal")).getByRole("status")).toHaveTextContent("The pane is gone");
  });

  it("says when tmux is not available", async () => {
    const d = open();
    await userEvent.click(tab("Terminal"));
    d.terminals.socket("%5").drop(1013);
    expect(within(panel("Terminal")).getByRole("status")).toHaveTextContent("tmux is not available");
    await userEvent.click(within(panel("Terminal")).getByRole("button", { name: "Try again" }));
    expect(d.terminals.sockets.filter((s) => s.pane === "%5")).toHaveLength(2);
  });
});

describe("the Shell and nvim tabs", () => {
  it("opens the shell of the session one time and keeps it", async () => {
    const d = open();
    await userEvent.click(tab("Shell"));
    await waitFor(() => expect(d.terminals.socket("%7")).toBeTruthy());
    await userEvent.click(tab("Chat"));
    await userEvent.click(tab("Shell"));
    expect(posts(d, "/api/v1/sessions/s1/shell")).toBe(1);
    expect(d.terminals.sockets.filter((s) => s.pane === "%7")).toHaveLength(1);
  });

  it("toggles nvim only one time, so a second visit does not hide it", async () => {
    const d = open();
    await userEvent.click(tab("nvim"));
    await waitFor(() => expect(d.terminals.socket("%8")).toBeTruthy());
    await userEvent.click(tab("Terminal"));
    await userEvent.click(tab("nvim"));
    await userEvent.click(tab("nvim"));
    expect(posts(d, "/api/v1/sessions/s1/nvim")).toBe(1);
  });

  it("keeps a shell for each session", async () => {
    const d = open();
    await userEvent.click(tab("Shell"));
    await waitFor(() => expect(d.terminals.socket("%7")).toBeTruthy());
    await userEvent.click(screen.getByRole("link", { name: /add retries/ }));
    await waitFor(() => expect(d.terminals.socket("%11")).toBeTruthy());
    await userEvent.click(screen.getByRole("link", { name: /fix the login redirect/ }));
    expect(posts(d, "/api/v1/sessions/s1/shell")).toBe(1);
    expect(posts(d, "/api/v1/sessions/s2/shell")).toBe(1);
  });

  it("opens Shell with Ctrl+Shift+T and nvim with Ctrl+Shift+E", async () => {
    open();
    await userEvent.keyboard("{Control>}t{/Control}");
    expect(tab("Chat")).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Control>}{Shift>}t{/Shift}{/Control}");
    expect(tab("Shell")).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Control>}{Shift>}e{/Shift}{/Control}");
    expect(tab("nvim")).toHaveAttribute("aria-selected", "true");
  });
});

describe("the tabs on a phone", () => {
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
