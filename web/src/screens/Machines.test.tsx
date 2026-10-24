import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App, type AppEnv } from "../App";
import { FakeServer, MemoryStorage } from "../test/fake-server";
import { FakeDesktop } from "../test/fake-desktop";
import { FakeSockets } from "../test/fake-socket";
import { FakeWidth } from "../test/fake-width";
import { sshTarget } from "../servers";

const device = { id: "k3m9p2qx", name: "Laptop", created_at: "2026-10-03T10:00:00Z", last_seen: "2026-10-03T10:00:00Z" };

afterEach(() => {
  window.location.hash = "";
});

function answers(desktop: FakeDesktop) {
  desktop.handlers.crew_machine_request = (args) => {
    const id = String(args?.machineId);
    const name = id === "local" ? "mac" : id.replace(/^ssh:/, "");
    const path = String(args?.path);
    const body =
      path === "/api/v1/environments"
        ? { machine: { id: "m-" + name, name }, identities: [{ name: "yours", kind: "local", parts: [], secrets: [], used_by: id === "local" ? ["ada"] : [] }], found: null }
        : path === "/api/v1/mates"
          ? { mates: id === "local" ? [{ name: "ada" }] : [] }
          : path === "/api/v1/hello"
            ? { api: "v1", build: "v0.42.1" }
            : [];
    return { status: 200, body: JSON.stringify(body) };
  };
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

describe("machines in the desktop app", () => {
  it("has no server switcher in the sidebar", async () => {
    const desktop = answers(new FakeDesktop());
    app("#/envs", { desktop });
    await screen.findByRole("list", { name: "Environments" });
    expect(screen.queryByRole("button", { name: /^Server:/ })).not.toBeInTheDocument();
    expect(screen.queryByText("This computer")).not.toBeInTheDocument();
  });

  it("has no Servers group in Settings, and #/servers shows Environments", async () => {
    const desktop = answers(new FakeDesktop());
    app("#/settings", { desktop });
    const nav = screen.getByRole("navigation", { name: "Settings" });
    expect(within(nav).queryByRole("button", { name: "Servers" })).not.toBeInTheDocument();
    window.location.hash = "#/servers";
    expect(await screen.findByRole("list", { name: "Environments" })).toBeInTheDocument();
  });

  it("connects a server over SSH with + Machine and adds it to the list (11d)", async () => {
    const user = userEvent.setup();
    const desktop = answers(new FakeDesktop());
    app("#/envs", { desktop });
    await user.click(await screen.findByRole("button", { name: "+ Machine" }));
    const dialog = screen.getByRole("dialog", { name: "Connect a server" });
    expect(dialog).toHaveTextContent("crew connects over SSH and installs its own crew there. The server becomes a machine in Environments, with your accounts on it.");
    await user.type(within(dialog).getByLabelText("SSH address"), "giovani@devbox");
    await user.click(within(dialog).getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(window.location.hash).toBe("#/envs/" + encodeURIComponent("ssh:giovani@devbox")));
    expect(desktop.of("crew_server_crew")).toEqual([{ target: "giovani@devbox" }]);
    expect(desktop.of("crew_server_add")).toEqual([{ kind: "ssh", target: "giovani@devbox", code: "" }]);
    const list = screen.getByRole("list", { name: "Environments" });
    expect(await within(list).findByRole("link", { name: /devbox/ })).toBeInTheDocument();
  });

  it("installs crew on the server when it is not there, and shows each step", async () => {
    const user = userEvent.setup();
    const desktop = answers(new FakeDesktop());
    desktop.handlers.crew_server_crew = () => ({ action: "install", server: null, app: "v0.42.1" });
    let release: () => void = () => undefined;
    desktop.pending.crew_server_add = new Promise<void>((r) => (release = r));
    app("#/envs", { desktop });
    await user.click(await screen.findByRole("button", { name: "+ Machine" }));
    const dialog = screen.getByRole("dialog", { name: "Connect a server" });
    await user.type(within(dialog).getByLabelText("SSH address"), "devbox");
    await user.click(within(dialog).getByRole("button", { name: "Connect" }));
    expect(await within(dialog).findByText("Connected over SSH")).toBeInTheDocument();
    expect(await within(dialog).findByText("crew v0.42.1 installed and running")).toBeInTheDocument();
    expect(desktop.of("crew_server_install")).toEqual([{ target: "devbox" }]);
    release();
    await waitFor(() => expect(window.location.hash).toBe("#/envs/" + encodeURIComponent("ssh:devbox")));
  });

  it("shows why a connection failed", async () => {
    const user = userEvent.setup();
    const desktop = answers(new FakeDesktop());
    desktop.failures.crew_server_crew = "ssh: connect to host devbox port 22: Connection refused";
    app("#/envs", { desktop });
    await user.click(await screen.findByRole("button", { name: "+ Machine" }));
    const dialog = screen.getByRole("dialog", { name: "Connect a server" });
    await user.type(within(dialog).getByLabelText("SSH address"), "devbox");
    await user.click(within(dialog).getByRole("button", { name: "Connect" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Connection refused");
    expect(desktop.of("crew_server_add")).toEqual([]);
  });

  it("disconnects a server from the machine ⋯ menu and fixes it", async () => {
    const user = userEvent.setup();
    const desktop = answers(new FakeDesktop());
    desktop.servers = [...desktop.servers, { id: "ssh:box", name: "box", kind: "ssh", detail: "over SSH" }];
    app("#/envs/" + encodeURIComponent("ssh:box"), { desktop });
    await screen.findByRole("heading", { name: "box" });
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Fix" }));
    await waitFor(() => expect(desktop.of("crew_server_fix")).toEqual([{ id: "ssh:box" }]));
    await user.click(screen.getByRole("button", { name: "Disconnect box…" }));
    const dialog = screen.getByRole("dialog", { name: "Disconnect box?" });
    await user.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(desktop.of("crew_server_remove")).toEqual([{ id: "ssh:box" }]));
    await waitFor(() => expect(window.location.hash).toBe("#/envs"));
  });

  it("has no + Machine and no Disconnect for This Mac", async () => {
    const desktop = answers(new FakeDesktop());
    app("#/envs/local", { desktop });
    await screen.findByRole("heading", { name: "This Mac" });
    expect(screen.queryByRole("button", { name: /Disconnect/ })).not.toBeInTheDocument();
  });

  it("shows no Add a server sheet on the first start of the desktop app", async () => {
    const desktop = new FakeDesktop();
    desktop.firstRun = true;
    app("", { desktop });
    await waitFor(() => expect(desktop.of("crew_servers").length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("dialog", { name: "Add a server" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Get started" })).not.toBeInTheDocument();
  });

  it("has no + Machine outside the desktop app", async () => {
    app("#/envs");
    await screen.findByRole("list", { name: "Environments" });
    expect(screen.queryByRole("button", { name: "+ Machine" })).not.toBeInTheDocument();
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

describe("an SSH target", () => {
  it("refuses an SSH target with options, spaces or quotes", () => {
    expect(sshTarget(" me@box ")).toBe("me@box");
    expect(sshTarget("-oProxyCommand=sh")).toBeNull();
    expect(sshTarget("box rm")).toBeNull();
    expect(sshTarget("box'")).toBeNull();
    expect(sshTarget("")).toBeNull();
    expect(sshTarget("ssh me@box")).toBe("me@box");
    expect(sshTarget("  ssh   server ")).toBe("server");
    expect(sshTarget("ssh")).toBe("ssh");
    expect(sshTarget("ssh -p 22 box")).toBeNull();
  });
});
