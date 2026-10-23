import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { desktop, goldenState, session } from "../test/desktop";

afterEach(() => {
  window.location.hash = "";
});

const options = { harnesses: [{ harness: "claude", name: "Claude Code", tag: "CC", models: ["opus", "sonnet"], efforts: ["low", "high"], model: "", effort: "" }], home: "/home/me" };

function menuOf(name: string) {
  fireEvent.contextMenu(within(screen.getByRole("navigation", { name: "Sidebar" })).getByRole("link", { name: new RegExp(name) }));
  return screen.getByRole("menu", { name: "Session commands" });
}

function items(menu: HTMLElement): string[] {
  return within(menu)
    .getAllByRole("menuitem")
    .map((i) => i.textContent ?? "");
}

function setup(extra: Parameters<typeof session>[2] = {}, hash = "") {
  const d = desktop(hash);
  d.live({ ...goldenState(), sessions: [session("a", "alpha", { Harness: "claude", Model: "sonnet", Effort: "high", ...extra })] });
  return d;
}

function posts(server: ReturnType<typeof desktop>["server"]) {
  return server.calls.filter((c) => c.method === "POST").map((c) => [c.path, c.body]);
}

describe("the session commands", () => {
  it("has the commands of the Mac app in the context menu of a sidebar row", () => {
    setup();
    expect(items(menuOf("alpha"))).toEqual(["Rename…", "Mute", "Model…", "Effort…", "Kill dev servers", "End session…"]);
  });

  it("shows Unmute for a muted session and only Resume for an ended session", () => {
    const d = desktop();
    d.live({ ...goldenState(), sessions: [session("a", "alpha", { Muted: true }), session("b", "beta", { Ended: true, order: -1 })] });
    expect(items(menuOf("alpha"))).toContain("Unmute");
    fireEvent.keyDown(screen.getByRole("menu", { name: "Session commands" }), { key: "Escape" });
    expect(items(menuOf("beta"))).toEqual(["Resume"]);
  });

  it("renames a session", async () => {
    const { server } = setup();
    server.on("POST", "/api/v1/sessions/a/rename", { status: 200, body: {} });
    await userEvent.click(within(menuOf("alpha")).getByRole("menuitem", { name: "Rename…" }));
    const dialog = screen.getByRole("dialog", { name: "Rename session" });
    const name = within(dialog).getByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    await userEvent.type(name, "login fix");
    await userEvent.click(within(dialog).getByRole("button", { name: "Rename" }));
    expect(posts(server)).toEqual([["/api/v1/sessions/a/rename", { name: "login fix" }]]);
    expect(screen.queryByRole("dialog", { name: "Rename session" })).not.toBeInTheDocument();
  });

  it("mutes a session", async () => {
    const { server } = setup();
    server.on("POST", "/api/v1/sessions/a/mute", { status: 200, body: {} });
    await userEvent.click(within(menuOf("alpha")).getByRole("menuitem", { name: "Mute" }));
    expect(posts(server)).toEqual([["/api/v1/sessions/a/mute", { muted: true }]]);
  });

  it("switches the model to a choice of the harness", async () => {
    const { server } = setup();
    server.on("GET", "/api/v1/session-options", { status: 200, body: options });
    server.on("POST", "/api/v1/sessions/a/switch", { status: 200, body: {} });
    await userEvent.click(within(menuOf("alpha")).getByRole("menuitem", { name: "Model…" }));
    const dialog = await screen.findByRole("dialog", { name: "Switch model" });
    expect(within(dialog).getByRole("button", { name: "sonnet" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(dialog).getByRole("button", { name: "opus" }));
    expect(posts(server)).toEqual([["/api/v1/sessions/a/switch", { kind: "model", value: "opus" }]]);
  });

  it("switches the effort", async () => {
    const { server } = setup();
    server.on("GET", "/api/v1/session-options", { status: 200, body: options });
    server.on("POST", "/api/v1/sessions/a/switch", { status: 200, body: {} });
    await userEvent.click(within(menuOf("alpha")).getByRole("menuitem", { name: "Effort…" }));
    const dialog = await screen.findByRole("dialog", { name: "Switch effort" });
    await userEvent.click(within(dialog).getByRole("button", { name: "low" }));
    expect(posts(server)).toEqual([["/api/v1/sessions/a/switch", { kind: "effort", value: "low" }]]);
  });

  it("asks before it ends a session", async () => {
    const { server } = setup();
    server.on("POST", "/api/v1/sessions/a/end", { status: 200, body: {} });
    await userEvent.click(within(menuOf("alpha")).getByRole("menuitem", { name: "End session…" }));
    const dialog = screen.getByRole("alertdialog", { name: "End this session?" });
    expect(posts(server)).toEqual([]);
    await userEvent.click(within(dialog).getByRole("button", { name: "End session" }));
    expect(posts(server)).toEqual([["/api/v1/sessions/a/end", undefined]]);
  });

  it("ends a session at once when the setting is off", async () => {
    const d = desktop();
    d.storage.setItem("crew.confirmEnd", "off");
    d.live({ ...goldenState(), sessions: [session("a", "alpha")] });
    d.server.on("POST", "/api/v1/sessions/a/end", { status: 200, body: {} });
    await userEvent.click(within(menuOf("alpha")).getByRole("menuitem", { name: "End session…" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(posts(d.server)).toEqual([["/api/v1/sessions/a/end", undefined]]);
  });

  it("resumes an ended session", async () => {
    const { server } = setup({ Ended: true, order: -1 });
    server.on("POST", "/api/v1/sessions/a/resume", { status: 200, body: {} });
    await userEvent.click(within(menuOf("alpha")).getByRole("menuitem", { name: "Resume" }));
    expect(posts(server)).toEqual([["/api/v1/sessions/a/resume", undefined]]);
  });

  it("kills the dev servers and tells how many stopped", async () => {
    const { server } = setup();
    server.on("POST", "/api/v1/sessions/a/kill-dev-servers", { status: 200, body: { killed: [4, 7] } });
    await userEvent.click(within(menuOf("alpha")).getByRole("menuitem", { name: "Kill dev servers" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Stopped 2 dev servers.");
  });

  it("tells when no dev servers run", async () => {
    const { server } = setup();
    server.on("POST", "/api/v1/sessions/a/kill-dev-servers", { status: 200, body: { killed: [] } });
    await userEvent.click(within(menuOf("alpha")).getByRole("menuitem", { name: "Kill dev servers" }));
    expect(await screen.findByRole("status")).toHaveTextContent("No dev servers are running in this session's worktrees.");
  });

  it("shows the message of the daemon when a command fails", async () => {
    const { server } = setup();
    server.on("POST", "/api/v1/sessions/a/mute", { status: 500, body: { error: { code: "failed", message: "session a is gone" } } });
    await userEvent.click(within(menuOf("alpha")).getByRole("menuitem", { name: "Mute" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("session a is gone");
  });

  it("opens the same commands from the toolbar for the selected session", async () => {
    setup({}, "#/sessions/a");
    await userEvent.click(screen.getByRole("button", { name: "Session commands" }));
    expect(items(screen.getByRole("menu", { name: "Session commands" }))).toContain("End session…");
  });

  it("opens the commands from the header of the chat on a phone", async () => {
    const d = desktop("#/sessions/a", false);
    d.live({ ...goldenState(), sessions: [session("a", "alpha")] });
    await userEvent.click(screen.getByRole("button", { name: "Session commands" }));
    expect(items(screen.getByRole("menu", { name: "Session commands" }))).toContain("Rename…");
  });
});

describe("the end confirmation setting", () => {
  it("is on by default and Settings turns it off", async () => {
    const d = desktop("#/settings", false);
    d.live();
    const box = screen.getByRole("switch", { name: "Ask before I end a session" });
    expect(box).toHaveAttribute("aria-checked", "true");
    await userEvent.click(box);
    expect(d.storage.getItem("crew.confirmEnd")).toBe("off");
  });
});
