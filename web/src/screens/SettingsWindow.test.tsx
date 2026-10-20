import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { loadSettings } from "../settings";
import { desktop } from "../test/desktop";
import type { FakeServer } from "../test/fake-server";

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

async function open(group: "This app" | "Server", name: string, hash = "#/settings", wide = true) {
  const view = desktop(hash, wide);
  withServer(view.server);
  view.live();
  await userEvent.click(within(screen.getByRole("list", { name: group })).getByRole("button", { name }));
  return view;
}

describe("the Settings window", () => {
  it("opens from the sidebar in the main column, with the app and server groups", async () => {
    const { live } = desktop();
    live();
    await userEvent.click(within(screen.getByRole("navigation", { name: "Sidebar" })).getByRole("link", { name: "Settings" }));
    const main = screen.getAllByRole("main")[0];
    expect(within(main).getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(within(within(main).getByRole("list", { name: "This app" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["General", "Notifications", "Appearance", "Shortcuts"]);
    expect(within(within(main).getByRole("list", { name: "Server" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["Workspaces", "Agents", "Notifications", "Appearance"]);
  });

  it("keeps the groups on a phone, with the tab bar", async () => {
    await open("Server", "Workspaces", "#/settings", false);
    expect(await screen.findByText("/home/me/api")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Screens" })).toBeInTheDocument();
  });
});

describe("the app settings", () => {
  it("keeps General in the app store", async () => {
    const { storage } = await open("This app", "General");
    await userEvent.click(screen.getByRole("checkbox", { name: "Confirm before End session" }));
    const shown = screen.getByRole("spinbutton", { name: "Ended sessions shown" });
    await userEvent.clear(shown);
    await userEvent.type(shown, "25");
    expect(loadSettings(storage).general).toMatchObject({ confirmOnEnd: false, endedShown: 25 });
  });

  it("keeps Notifications in the app store", async () => {
    const { storage } = await open("This app", "Notifications");
    await userEvent.click(screen.getByRole("checkbox", { name: "Done: sound" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Also notify for muted sessions" }));
    expect(loadSettings(storage).notifications.done).toEqual({ banner: true, sound: true });
    expect(loadSettings(storage).notifications.notifyMuted).toBe(true);
  });

  it("keeps Appearance in the app store and clamps the font size", async () => {
    const { storage } = await open("This app", "Appearance");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Theme" }), "Mocha");
    const size = screen.getByRole("spinbutton", { name: "Terminal font size" });
    await userEvent.clear(size);
    await userEvent.type(size, "40");
    await userEvent.tab();
    expect(loadSettings(storage).appearance).toMatchObject({ theme: "mocha", fontSize: 24 });
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("the server settings", () => {
  it("adds a workspace from the path field with folder suggestions", async () => {
    const { server } = await open("Server", "Workspaces");
    expect(await screen.findByText("/home/me/api")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("combobox", { name: "Workspace path" }), "~/w");
    const list = await screen.findByRole("listbox", { name: "Folders" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["/home/me/web"]);
    await userEvent.click(within(list).getByRole("option", { name: "/home/me/web" }));
    await userEvent.click(screen.getByRole("button", { name: "Add workspace" }));
    await waitFor(() => expect(server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/workspaces")?.body).toEqual({ path: "/home/me/web" }));
  });

  it("shows the hooks of each agent and installs them", async () => {
    const { server } = await open("Server", "Agents");
    const codex = await screen.findByRole("group", { name: "Codex" });
    expect(within(codex).getByText("Hooks not installed")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Claude Code" })).getByText("Hooks installed in /home/me/.claude/settings.json")).toBeInTheDocument();
    await userEvent.click(within(codex).getByRole("button", { name: "Install hooks" }));
    await waitFor(() => expect(server.calls.find((c) => c.path === "/api/v1/onboarding/install")?.body).toEqual({ harness: "codex" }));
  });

  it("saves the agent defaults and the fallback threshold in config.toml", async () => {
    const { server } = await open("Server", "Agents");
    const claude = await screen.findByRole("group", { name: "Claude Code" });
    expect(within(claude).getByRole("combobox", { name: "Default model" })).toHaveValue("opus");
    await userEvent.selectOptions(within(claude).getByRole("combobox", { name: "Default effort" }), "high");
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
    const { server } = await open("Server", "Notifications");
    const tablet = await screen.findByRole("listitem", { name: "tablet" });
    expect(screen.getByRole("listitem", { name: "Laptop" })).toHaveTextContent("This device");
    await userEvent.click(within(tablet).getByRole("button", { name: "Revoke" }));
    await userEvent.click(screen.getByRole("button", { name: "Revoke tablet" }));
    await waitFor(() => expect(server.calls.some((c) => c.path === "/api/v1/devices/t4bl3t00/revoke")).toBe(true));
    await userEvent.click(screen.getByRole("button", { name: "Pair a device" }));
    expect(await screen.findByText("482913")).toBeInTheDocument();
  });

  it("saves the push delay", async () => {
    const { server } = await open("Server", "Notifications");
    const away = await screen.findByRole("textbox", { name: "Push after I am away for" });
    expect(away).toHaveValue("2m");
    await userEvent.clear(away);
    await userEvent.type(away, "5m");
    await userEvent.click(screen.getByRole("button", { name: "Save delay" }));
    await waitFor(() => expect(server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/config")?.body).toEqual({ key: "push.away_after", value: "5m" }));
  });

  it("saves a theme colour of the server", async () => {
    const { server } = await open("Server", "Appearance");
    const blue = await screen.findByRole("textbox", { name: "blue" });
    await userEvent.type(blue, "#1e66f5");
    await userEvent.click(screen.getByRole("button", { name: "Save blue" }));
    await waitFor(() => expect(server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/config")?.body).toEqual({ key: "theme.blue", value: "#1e66f5" }));
  });

  it("shows a note in a group when the server does not have the method", async () => {
    const view = desktop("#/settings");
    withServer(view.server).on("GET", "/api/v1/devices", { status: 501, body: { error: { code: "unknown_method", message: "no device.list" } } });
    view.live();
    await userEvent.click(within(screen.getByRole("list", { name: "Server" })).getByRole("button", { name: "Notifications" }));
    expect(await screen.findByText("This server does not have this setting. Update crew on the server to change it here.")).toBeInTheDocument();
  });

  it("shows a note when this device is not the owner device", async () => {
    const view = desktop("#/settings");
    withServer(view.server).on("GET", "/api/v1/workspaces/dirs?path=%2Fhome%2Fme", { status: 403, body: { error: { code: "forbidden", message: "only the owner device" } } });
    view.server.on("GET", "/api/v1/config", { status: 403, body: { error: { code: "forbidden", message: "only the owner device" } } });
    view.live();
    await userEvent.click(within(screen.getByRole("list", { name: "Server" })).getByRole("button", { name: "Appearance" }));
    expect(await screen.findByText("Only the owner device, the app on the computer that runs crew, can change this.")).toBeInTheDocument();
  });
});
