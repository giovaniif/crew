import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App, type AppEnv } from "../App";
import { Servers } from "../servers";
import { FakeServer, MemoryStorage } from "../test/fake-server";
import { FakeDesktop } from "../test/fake-desktop";
import { FakeSockets } from "../test/fake-socket";
import { FakeWidth } from "../test/fake-width";
import { ServersScreen } from "./Servers";

const device = { id: "k3m9p2qx", name: "Laptop", created_at: "2026-10-03T10:00:00Z", last_seen: "2026-10-03T10:00:00Z" };

afterEach(() => {
  window.location.hash = "";
});

function withRemote(desktop = new FakeDesktop()) {
  desktop.servers = [
    ...desktop.servers,
    { id: "ssh:box", name: "box", kind: "ssh", detail: "over SSH" },
    { id: "url:crew.example.ts.net", name: "crew.example.ts.net", kind: "url", detail: "https://crew.example.ts.net/" },
  ];
  return desktop;
}

function app(hash: string, options: { desktop?: FakeDesktop; connectUrl?: string; paired?: boolean } = {}) {
  window.location.hash = hash;
  const storage = new MemoryStorage();
  if (options.paired !== false) {
    storage.setItem("crew.auth", JSON.stringify({ token: "t0k", device }));
  }
  const server = new FakeServer()
    .on("GET", "/api/v1/hello", { status: 200, body: { api: "v1", build: "v0.12.0+abc" } })
    .on("GET", "/api/v1/workspaces", { status: 200, body: { workspaces: [], last_used: "" } });
  const env: AppEnv = {
    fetch: server.fetch,
    storage,
    installed: true,
    hash,
    host: "crew.example.ts.net",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    openStream: new FakeSockets().open,
    now: () => Date.parse("2026-10-03T12:00:00Z"),
    onHashChange: (cb) => {
      const listener = () => cb(window.location.hash);
      window.addEventListener("hashchange", listener);
      return () => window.removeEventListener("hashchange", listener);
    },
    wide: new FakeWidth(true),
    desktop: options.desktop,
    connectUrl: options.connectUrl,
  };
  render(<App env={env} />);
}

describe("Servers", () => {
  it("lists the servers and marks the current one", async () => {
    const desktop = withRemote();
    render(<ServersScreen servers={new Servers(desktop)} />);
    const rows = await screen.findAllByRole("listitem");
    expect(rows.map((r) => within(r).getByRole("heading").textContent)).toEqual(["This computer", "box", "crew.example.ts.net"]);
    expect(within(rows[0]).getByText("Current")).toBeInTheDocument();
    expect(within(rows[0]).queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(within(rows[1]).getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a server" })).toHaveAttribute("href", "#/servers/add");
  });

  it("opens, fixes and removes a server", async () => {
    const desktop = withRemote();
    render(<ServersScreen servers={new Servers(desktop)} />);
    const box = () => screen.getByRole("listitem", { name: "box" });
    await screen.findByRole("listitem", { name: "box" });
    await userEvent.click(within(box()).getByRole("button", { name: "Fix" }));
    expect(desktop.of("crew_server_fix")).toEqual([{ id: "ssh:box" }]);
    expect(await within(box()).findByText("Fixed")).toBeInTheDocument();
    await userEvent.click(within(box()).getByRole("button", { name: "Open" }));
    expect(desktop.of("crew_server_open")).toEqual([{ id: "ssh:box" }]);
    await userEvent.click(within(box()).getByRole("button", { name: "Remove" }));
    expect(desktop.of("crew_server_remove")).toEqual([{ id: "ssh:box" }]);
    expect(await screen.findAllByRole("listitem")).toHaveLength(2);
  });

  it("has no Fix for a server added by its address", async () => {
    render(<ServersScreen servers={new Servers(withRemote())} />);
    const byAddress = await screen.findByRole("listitem", { name: "crew.example.ts.net" });
    expect(within(byAddress).queryByRole("button", { name: "Fix" })).not.toBeInTheDocument();
    expect(within(byAddress).getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("shows why a Fix failed", async () => {
    const desktop = withRemote();
    desktop.failures.crew_server_fix = "the daemon still fails: exec format error";
    render(<ServersScreen servers={new Servers(desktop)} />);
    const box = await screen.findByRole("listitem", { name: "box" });
    await userEvent.click(within(box).getByRole("button", { name: "Fix" }));
    expect(await within(box).findByRole("alert")).toHaveTextContent("exec format error");
  });

  it("switches servers from the chip in the sidebar", async () => {
    const desktop = withRemote();
    app("", { desktop });
    const chip = await screen.findByRole("button", { name: "Server: This computer" });
    await userEvent.click(chip);
    const menu = screen.getByRole("menu", { name: "Servers" });
    expect(within(menu).getByRole("menuitemradio", { name: "This computer" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(within(menu).getByRole("menuitemradio", { name: "box" }));
    expect(desktop.of("crew_server_open")).toEqual([{ id: "ssh:box" }]);
  });

  it("opens Add a server from the chip", async () => {
    const desktop = new FakeDesktop();
    app("", { desktop });
    await userEvent.click(await screen.findByRole("button", { name: "Server: This computer" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Add a server…" }));
    expect(window.location.hash).toBe("#/servers/add");
    expect(await screen.findByRole("dialog", { name: "Add a server" })).toBeInTheDocument();
  });

  it("shows the first run flow on the first start of the desktop app", async () => {
    const desktop = new FakeDesktop();
    desktop.firstRun = true;
    app("", { desktop });
    const dialog = await screen.findByRole("dialog", { name: "Add a server" });
    expect(within(dialog).getByRole("button", { name: "Get started" })).toBeInTheDocument();
  });

  it("shows no chip outside the desktop app", () => {
    app("");
    expect(screen.queryByRole("button", { name: /^Server:/ })).not.toBeInTheDocument();
  });

  it("lets the mobile app change the server from Settings", () => {
    app("#/settings", { connectUrl: "tauri://localhost/index.html?change" });
    expect(screen.getByRole("link", { name: "Change server" })).toHaveAttribute("href", "tauri://localhost/index.html?change");
  });

  it("lets the mobile app change the server before it pairs", () => {
    app("", { connectUrl: "tauri://localhost/index.html?change", paired: false });
    expect(screen.getByRole("link", { name: "Change server" })).toHaveAttribute("href", "tauri://localhost/index.html?change");
  });

  it("shows no Change server link in a browser", () => {
    app("#/settings");
    expect(screen.queryByRole("link", { name: "Change server" })).not.toBeInTheDocument();
  });
});
