import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { defaultSettings, loadSettings } from "../settings";
import { desktop } from "../test/desktop";
import type { FakeServer } from "../test/fake-server";
import { FakeDesktop } from "../test/fake-desktop";
import { pick } from "../test/pick";

const defaults = defaultSettings();

afterEach(() => {
  window.location.hash = "";
});

const config = { path: "/home/me/.crew/config.toml", values: { "fallback.threshold": "80", "push.away_after": "2m", "defaults.claude.model": "opus" } };
const onboarding = {
  done: true,
  harnesses: { claude: { installed: true, file: "/home/me/.claude/settings.json" }, codex: { installed: false, file: "/home/me/.codex/hooks.json" } },
  nvim: { on_path: true, configured: false, config_file: "/home/me/.config/nvim/init.lua", plugin_dir: "/home/me/.crew/nvim", plugin_found: true },
};
const options = {
  home: "/home/me",
  harnesses: [
    { harness: "claude", name: "Claude Code", models: ["opus", "sonnet"], efforts: ["low", "high"], default_model: "opus" },
    { harness: "codex", name: "Codex", models: ["gpt-5"], efforts: ["medium"] },
  ],
};
const devices = {
  devices: [
    { id: "k3m9p2qx", name: "Laptop", created_at: "2026-10-03T10:00:00Z", last_seen: "2026-10-03T10:00:00Z" },
    { id: "t4bl3t00", name: "tablet", created_at: "2026-10-03T10:00:00Z", last_seen: "2026-10-03T11:00:00Z" },
  ],
};

function withServer(server: FakeServer) {
  server
    .on("GET", "/api/v1/config", { status: 200, body: config })
    .on("POST", "/api/v1/config", (call) => {
      const body = call.body as { key: string; value: string };
      return { status: 200, body: { path: config.path, values: { ...config.values, [body.key]: body.value } } };
    })
    .on("GET", "/api/v1/onboarding", { status: 200, body: onboarding })
    .on("POST", "/api/v1/onboarding/install", { status: 200, body: { installed: true, file: "/home/me/.codex/hooks.json" } })
    .on("GET", "/api/v1/session-options", { status: 200, body: options })
    .on("GET", "/api/v1/workspaces", { status: 200, body: { workspaces: [{ Root: "/home/me/api", Kind: "single", LastUsed: "" }], last_used: "/home/me/api" } })
    .on("GET", "/api/v1/workspaces/dirs?path=%2Fhome%2Fme", {
      status: 200,
      body: { dirs: [{ Name: "web", Path: "/home/me/web", Git: 1 }, { Name: "notes", Path: "/home/me/notes", Git: 0 }, { Name: "api", Path: "/home/me/api", Git: 1 }] },
    })
    .on("POST", "/api/v1/workspaces", { status: 200, body: { Root: "/home/me/web", Kind: "single", LastUsed: "" } })
    .on("GET", "/api/v1/devices", { status: 200, body: devices })
    .on("POST", "/api/v1/devices/t4bl3t00/revoke", { status: 200, body: {} })
    .on("POST", "/api/v1/pair/code", { status: 200, body: { code: "482913", expires_at: "2026-10-03T12:35:00Z" } });
  return server;
}

const groups = ["General", "Notifications", "Appearance", "Shortcuts", "Workspaces", "Agents", "Devices"];

async function open(name: string, hash = "#/settings", wide = true) {
  const view = desktop(hash, wide);
  withServer(view.server);
  view.live();
  await userEvent.click(within(screen.getByRole("navigation", { name: "Settings" })).getByRole("button", { name }));
  return view;
}

describe("the Settings window", () => {
  it("opens from the sidebar with one menu that merges the app and server groups", async () => {
    const { live } = desktop();
    live();
    await userEvent.click(within(screen.getByRole("navigation", { name: "Sidebar" })).getByRole("link", { name: "Settings" }));
    const nav = screen.getByRole("navigation", { name: "Settings" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(groups);
    expect(within(nav).getByRole("link", { name: /Back/ })).toHaveAttribute("href", "#/");
  });

  it("keeps the menu on a phone, with the tab bar", async () => {
    await open("Workspaces", "#/settings", false);
    expect(await screen.findByText("/home/me/api")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Screens" })).toBeInTheDocument();
  });

  it("tags the rows that the server keeps", async () => {
    await open("Notifications");
    const row = await screen.findByRole("combobox", { name: "Push to my phone after I'm away for" });
    expect(row.closest(".opt")).toHaveTextContent("server");
  });
});

describe("the app settings", () => {
  it("keeps General in the app store", async () => {
    const { storage } = await open("General");
    await userEvent.click(screen.getByRole("switch", { name: "Show subagents" }));
    await userEvent.click(screen.getByRole("switch", { name: "Ask before I end a session" }));
    const shown = screen.getByRole("spinbutton", { name: "Ended sessions shown" });
    await userEvent.clear(shown);
    await userEvent.type(shown, "25");
    expect(loadSettings(storage).general).toMatchObject({ endedShown: 25, showSubagents: !defaults.general.showSubagents });
    expect(storage.getItem("crew.confirmEnd")).toBe("off");
  });

  it("keeps Notifications in the store that the banners read, one row for each event with a banner Switch and a sound Select", async () => {
    const { storage } = await open("Notifications");
    const group = screen.getByRole("region", { name: "Sessions" });
    expect(within(group).getByText("Event")).toBeInTheDocument();
    expect(within(group).getByText("Banner")).toBeInTheDocument();
    await userEvent.click(within(group).getByRole("switch", { name: "Session hits a limit or an error" }));
    await pick(userEvent.setup(), within(group).getByRole("combobox", { name: "Sound when session finished" }), "Default");
    await userEvent.click(screen.getByRole("switch", { name: "Also notify for muted sessions" }));
    const alerts = JSON.parse(storage.getItem("crew.alerts") ?? "{}");
    expect(alerts.limitOrError.banner).toBe(!defaults.notifications.limitOrError.banner);
    expect(alerts.done.sound).toBe(true);
    expect(alerts.notifyMuted).toBe(true);
    expect(within(group).getByRole("combobox", { name: "Sound when session asks permission" })).toHaveTextContent("Default");
    expect(screen.queryByRole("checkbox", { name: /Sound when/ })).toBeNull();
  });

  it("keeps Appearance in the app store and clamps the font size", async () => {
    const { storage } = await open("Appearance");
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Theme" })).getByRole("radio", { name: "Dark" }));
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Accent" })).getByRole("radio", { name: "Green" }));
    const size = screen.getByRole("spinbutton", { name: "Terminal font size" });
    await userEvent.clear(size);
    await userEvent.type(size, "40");
    await userEvent.tab();
    expect(loadSettings(storage).appearance).toMatchObject({ theme: "mocha", accent: "green", fontSize: 24 });
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("the server settings", () => {
  it("adds a workspace from the path field with folder suggestions", async () => {
    const { server } = await open("Workspaces");
    expect(await screen.findByText("/home/me/api")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add a folder…" }));
    await userEvent.type(screen.getByRole("combobox", { name: "Workspace path" }), "~/w");
    const list = await screen.findByRole("listbox", { name: "Folders" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["/home/me/web"]);
    await userEvent.click(within(list).getByRole("option", { name: "/home/me/web" }));
    await userEvent.click(screen.getByRole("button", { name: "Add workspace" }));
    await waitFor(() => expect(server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/workspaces")?.body).toEqual({ path: "/home/me/web" }));
  });

  it("has no Browse… for the path field outside the desktop app", async () => {
    await open("Workspaces");
    await userEvent.click(screen.getByRole("button", { name: "Add a folder…" }));
    expect(screen.getByRole("combobox", { name: "Workspace path" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Browse…" })).toBeNull();
  });

  it("fills the path field from the folder dialog of the desktop app", async () => {
    const app = new FakeDesktop();
    app.handlers.crew_pick_folder = () => "/home/me/web";
    const view = desktop("#/settings", true, undefined, { desktop: app });
    withServer(view.server);
    view.live();
    await userEvent.click(within(screen.getByRole("navigation", { name: "Settings" })).getByRole("button", { name: "Workspaces" }));
    await userEvent.click(screen.getByRole("button", { name: "Add a folder…" }));
    await userEvent.click(screen.getByRole("button", { name: "Browse…" }));
    expect(app.of("crew_pick_folder")).toEqual([{ near: "/home/me/api" }]);
    expect(screen.getByRole("combobox", { name: "Workspace path" })).toHaveValue("/home/me/web");
  });

  it("shows the hooks of each agent and installs them", async () => {
    const { server } = await open("Agents");
    const codex = await screen.findByRole("group", { name: "Codex" });
    expect(within(codex).getByText("Hooks not installed")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Claude Code" })).getByText("Hooks installed in /home/me/.claude/settings.json")).toBeInTheDocument();
    await userEvent.click(within(codex).getByRole("button", { name: "Install hooks" }));
    await waitFor(() => expect(server.calls.find((c) => c.path === "/api/v1/onboarding/install")?.body).toEqual({ harness: "codex" }));
  });

  it("saves the agent defaults and the fallback threshold in config.toml", async () => {
    const { server } = await open("Agents");
    const claude = await screen.findByRole("group", { name: "Claude Code" });
    expect(within(claude).getByRole("combobox", { name: "Default model" })).toHaveTextContent("opus");
    await pick(userEvent.setup(), within(claude).getByRole("combobox", { name: "Default effort" }), "high");
    const threshold = screen.getByRole("spinbutton", { name: "Fallback threshold (%)" });
    await userEvent.clear(threshold);
    await userEvent.type(threshold, "90");
    await userEvent.click(screen.getByRole("button", { name: "Save threshold" }));
    await waitFor(() =>
      expect(server.calls.filter((c) => c.method === "POST" && c.path === "/api/v1/config").map((c) => c.body)).toEqual([
        { key: "defaults.claude.effort", value: "high" },
        { key: "fallback.threshold", value: "90" },
      ]),
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved fallback.threshold in /home/me/.crew/config.toml"));
  });

  it("lists the devices, revokes one and shows a pair code", async () => {
    const { server } = await open("Devices");
    const tablet = await screen.findByRole("listitem", { name: "tablet" });
    expect(screen.getByRole("listitem", { name: "Laptop" })).toHaveTextContent("This device");
    await userEvent.click(within(tablet).getByRole("button", { name: "Revoke" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Revoke tablet?" })).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(server.calls.some((c) => c.path === "/api/v1/devices/t4bl3t00/revoke")).toBe(true));
    await userEvent.click(screen.getByRole("button", { name: "Pair a device" }));
    expect(await screen.findByText("482913")).toBeInTheDocument();
  });

  it("saves the push delay", async () => {
    const { server } = await open("Notifications");
    const away = await screen.findByRole("combobox", { name: "Push to my phone after I'm away for" });
    await waitFor(() => expect(away).toHaveTextContent("2 min"));
    await pick(userEvent.setup(), away, "5 min");
    await waitFor(() => expect(server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/config")?.body).toEqual({ key: "push.away_after", value: "5m" }));
  });

  it("shows a failed push delay save next to the delay", async () => {
    const view = desktop("#/settings");
    withServer(view.server).on("POST", "/api/v1/config", { status: 400, body: { error: { code: "bad_request", message: "push.away_after: invalid duration" } } });
    view.live();
    await userEvent.click(within(screen.getByRole("navigation", { name: "Settings" })).getByRole("button", { name: "Notifications" }));
    await pick(userEvent.setup(), await screen.findByRole("combobox", { name: "Push to my phone after I'm away for" }), "10 min");
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid duration");
  });

  it("removes a workspace from its menu after a confirm", async () => {
    const { server } = await open("Workspaces");
    await userEvent.click(await screen.findByRole("button", { name: "More for /home/me/api" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Remove /home/me/api?" })).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(server.calls.some((c) => c.method !== "GET" && c.path.startsWith("/api/v1/workspaces"))).toBe(true));
  });

  it("shows no TUI colours under Appearance", async () => {
    await open("Appearance");
    await screen.findByRole("radiogroup", { name: "Theme" });
    expect(screen.queryByRole("region", { name: "TUI colors" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "blue" })).toBeNull();
  });

  it("shows a note in a group when the server does not have the method", async () => {
    const view = desktop("#/settings");
    withServer(view.server).on("GET", "/api/v1/devices", { status: 501, body: { error: { code: "unknown_method", message: "no device.list" } } });
    view.live();
    await userEvent.click(within(screen.getByRole("navigation", { name: "Settings" })).getByRole("button", { name: "Devices" }));
    expect(await screen.findByText("This server does not have this setting. Update crew on the server to change it here.")).toBeInTheDocument();
  });

  it("shows a note when this device is not the owner device", async () => {
    const view = desktop("#/settings");
    withServer(view.server).on("GET", "/api/v1/workspaces/dirs?path=%2Fhome%2Fme", { status: 403, body: { error: { code: "forbidden", message: "only the owner device" } } });
    view.server.on("GET", "/api/v1/config", { status: 403, body: { error: { code: "forbidden", message: "only the owner device" } } });
    view.live();
    await userEvent.click(within(screen.getByRole("navigation", { name: "Settings" })).getByRole("button", { name: "Agents" }));
    expect(await screen.findByText("Only the owner device, the app on the computer that runs crew, can change this.")).toBeInTheDocument();
  });
});
