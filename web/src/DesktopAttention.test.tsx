import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App, type AppEnv } from "./App";
import type { DesktopBridge } from "./desktop";
import type { Session } from "./stream";
import { FakeServer, MemoryStorage } from "./test/fake-server";
import { FakeSockets } from "./test/fake-socket";

const device = { id: "k3m9p2qx", name: "desktop", created_at: "2026-10-03T10:00:00Z", last_seen: "2026-10-03T10:00:00Z" };

function session(over: Partial<Session>): Session {
  return {
    ID: "s",
    TaskID: "t",
    Harness: "claude",
    Pane: "",
    Model: "",
    Effort: "",
    State: "idle",
    Ended: false,
    Unread: false,
    Focused: false,
    Muted: false,
    WorktreeIDs: null,
    ResumeID: "",
    Transcript: "",
    Dir: "",
    Usage: { ContextLeftPercent: 0, HasContext: false, LimitUsedPercent: 0 },
    Limits: null,
    LimitsAt: "0001-01-01T00:00:00Z",
    Switches: null,
    SwitchWarning: false,
    name: "",
    where: "",
    banner: "",
    since: null,
    ...over,
  };
}

class FakeDesktop implements DesktopBridge {
  calls: { cmd: string; args?: Record<string, unknown> }[] = [];
  isFocused = true;
  listeners: (() => void)[] = [];
  invoke = async (cmd: string, args?: Record<string, unknown>) => {
    this.calls.push({ cmd, args });
    return null;
  };
  focused = () => this.isFocused;
  onFocusChange = (listener: () => void) => {
    this.listeners.push(listener);
    return () => undefined;
  };
  of(cmd: string) {
    return this.calls.filter((c) => c.cmd === cmd).map((c) => c.args);
  }
}

function setup(hash: string) {
  const server = new FakeServer().on("GET", "/api/v1/hello", { status: 200, body: { api: "v1", build: "v0.12.0+abc" } });
  const storage = new MemoryStorage();
  const sockets = new FakeSockets();
  const desktop = new FakeDesktop();
  const env: AppEnv = {
    fetch: server.fetch,
    storage,
    installed: true,
    hash,
    host: "127.0.0.1:7420",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    openStream: sockets.open,
    now: () => Date.parse("2026-10-03T12:00:00Z"),
    onHashChange: () => () => undefined,
    visibility: { visible: () => true, onChange: () => () => undefined },
    desktopAuth: { token: "t0k", device },
    desktop,
  };
  return { env, sockets, desktop, storage };
}

const base = { workspaces: [], tasks: [], worktrees: [], limits: [], sends: [] };

describe("DesktopAttention", () => {
  it("posts a banner for a new banner of a session, and not for one that was there at connect", () => {
    const { env, sockets, desktop } = setup("");
    render(<App env={env} />);
    sockets.last.open();
    sockets.last.push({ state: { seq: 1, ...base, sessions: [session({ ID: "old", name: "old", State: "waiting", banner: "waits" })] } });
    sockets.last.push({ diff: { seq: 2, session: session({ ID: "a", name: "api", State: "permission", banner: "wants Bash" }) } });
    expect(desktop.of("crew_notify")).toEqual([{ banner: { id: "a", title: "api", body: "wants Bash", kind: "permission", sound: true } }]);
  });

  it("gives the tray menu and the badge to the app", () => {
    const { env, sockets, desktop } = setup("");
    render(<App env={env} />);
    sockets.last.open();
    sockets.last.push({
      state: { seq: 1, ...base, sessions: [session({ ID: "a", name: "api", where: "api@main", State: "permission" }), session({ ID: "b", State: "running", name: "web" })] },
    });
    const menus = desktop.of("crew_attention");
    const menu = menus[menus.length - 1]?.menu as { badge: number; needsYou: { id: string }[]; working: { id: string }[] };
    expect(menu.badge).toBe(1);
    expect(menu.needsYou.map((r) => r.id)).toEqual(["a"]);
    expect(menu.working.map((r) => r.id)).toEqual(["b"]);
  });

  it("tells the daemon which session is in view and if the window is in front", () => {
    const { env, sockets, desktop } = setup("#/sessions/a");
    render(<App env={env} />);
    sockets.last.open();
    sockets.last.push({ state: { seq: 1, ...base, sessions: [session({ ID: "a", name: "api" })] } });
    expect(sockets.last.sent).toContainEqual({ viewing: { session: "a", front: true } });
    desktop.isFocused = false;
    act(() => desktop.listeners.forEach((l) => l()));
    expect(sockets.last.sent).toContainEqual({ viewing: { session: "a", front: false } });
  });

  it("skips the banner of the session in view while the window is in front", () => {
    const { env, sockets, desktop } = setup("#/sessions/a");
    render(<App env={env} />);
    sockets.last.open();
    sockets.last.push({ state: { seq: 1, ...base, sessions: [session({ ID: "a", name: "api" })] } });
    sockets.last.push({ diff: { seq: 2, session: session({ ID: "a", name: "api", State: "waiting", banner: "waits" }) } });
    expect(desktop.of("crew_notify")).toEqual([]);
  });

  it("shows the notification settings of the desktop app and applies a change", async () => {
    const { env, sockets, desktop, storage } = setup("#/settings");
    render(<App env={env} />);
    const done = screen.getByRole("checkbox", { name: "Banner when a session is done" });
    expect(done).toBeChecked();
    await userEvent.click(done);
    expect(JSON.parse(storage.getItem("crew.alerts") ?? "{}").done.banner).toBe(false);
    sockets.last.open();
    sockets.last.push({ state: { seq: 1, ...base, sessions: [] } });
    sockets.last.push({ diff: { seq: 2, session: session({ ID: "a", name: "api", State: "done", banner: "finished" }) } });
    expect(desktop.of("crew_notify")).toEqual([]);
  });
});
