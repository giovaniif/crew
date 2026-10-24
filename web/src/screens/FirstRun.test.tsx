import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { loadChoices } from "../newsession";
import { Servers } from "../servers";
import { MemoryStorage } from "../test/fake-server";
import { FakeDesktop } from "../test/fake-desktop";
import { FirstRun } from "./FirstRun";

function start(welcome = true, desktop = new FakeDesktop(), mac = false) {
  const onClose = vi.fn();
  const storage = new MemoryStorage();
  render(<FirstRun servers={new Servers(desktop)} welcome={welcome} onClose={onClose} storage={storage} mac={mac} />);
  return { desktop, onClose, storage };
}

const progress = () =>
  within(screen.getByRole("list", { name: "Progress" }))
    .getAllByRole("listitem")
    .map((li) => li.getAttribute("data-state"));
const press = (name: string) => userEvent.click(screen.getByRole("button", { name }));

describe("FirstRun", () => {
  it("asks where agents run with three cards and a progress bar of three parts", async () => {
    start(false, new FakeDesktop(), true);
    expect(screen.getByRole("heading", { name: "Where do agents run?" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((r) => r.querySelector(".where-title")?.textContent)).toEqual(["This Mac", "Another computer, over SSH", "A paired server"]);
    expect(progress()).toEqual(["on", "off", "off"]);
  });

  it("sets up this computer with a live checklist, adds the first workspace and makes it the default project", async () => {
    const { desktop, onClose, storage } = start();
    await press("Get started");
    await userEvent.click(screen.getByRole("radio", { name: /This computer/ }));
    await press("Continue");
    expect(screen.getByRole("heading", { name: "Setting up this computer" })).toBeInTheDocument();
    expect(progress()).toEqual(["on", "on", "off"]);
    const checklist = screen.getByRole("list", { name: "Set up" });
    expect(await within(checklist).findByText("crew daemon started")).toBeInTheDocument();
    expect(desktop.of("crew_server_fix")).toEqual([{ id: "local" }]);
    await press("Continue");
    expect(progress()).toEqual(["on", "on", "on"]);
    await userEvent.type(screen.getByRole("textbox", { name: "First workspace" }), "~/code/api");
    await press("Open crew");
    expect(desktop.of("crew_server_workspace")).toEqual([{ id: "local", path: "~/code/api" }]);
    expect(desktop.of("crew_server_open")).toEqual([{ id: "local" }]);
    expect(loadChoices(storage).workspace).toBe("~/code/api");
    expect(onClose).toHaveBeenCalled();
  });

  it("fills the first workspace from the folder dialog of this computer", async () => {
    const desktop = new FakeDesktop();
    let picking: string | undefined;
    desktop.handlers.crew_pick_folder = () => {
      picking = document.documentElement.dataset.picking;
      return "/home/me/web";
    };
    start(false, desktop);
    await press("Continue");
    await within(screen.getByRole("list", { name: "Set up" })).findByText("crew daemon started");
    await press("Continue");
    await press("Browse…");
    expect(screen.getByRole("textbox", { name: "First workspace" })).toHaveValue("/home/me/web");
    expect(picking).toBe("true");
    expect(document.documentElement.dataset.picking).toBeUndefined();
  });

  it("keeps the typed workspace when the folder dialog is cancelled", async () => {
    const desktop = new FakeDesktop();
    desktop.handlers.crew_pick_folder = () => null;
    start(false, desktop);
    await press("Continue");
    await within(screen.getByRole("list", { name: "Set up" })).findByText("crew daemon started");
    await press("Continue");
    await userEvent.type(screen.getByRole("textbox", { name: "First workspace" }), "~/code/api");
    await press("Browse…");
    expect(screen.getByRole("textbox", { name: "First workspace" })).toHaveValue("~/code/api");
  });

  it("has no folder dialog for a server over SSH", async () => {
    start(false);
    await userEvent.click(screen.getByRole("radio", { name: /over SSH/ }));
    await press("Continue");
    await userEvent.type(screen.getByRole("combobox", { name: "SSH host" }), "gpu");
    await press("Continue");
    await within(screen.getByRole("list", { name: "Set up" })).findByText("crew set up on gpu");
    await press("Continue");
    expect(screen.getByRole("textbox", { name: "First workspace" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Browse…" })).toBeNull();
  });

  it("skips the first workspace and still opens crew", async () => {
    const { desktop, onClose } = start(false);
    await press("Continue");
    await within(screen.getByRole("list", { name: "Set up" })).findByText("crew daemon started");
    await press("Continue");
    await press("Skip");
    expect(desktop.of("crew_server_workspace")).toEqual([]);
    expect(desktop.of("crew_server_open")).toEqual([{ id: "local" }]);
    expect(onClose).toHaveBeenCalled();
  });

  it("pairs a remote crew serve with its address and code", async () => {
    const { desktop } = start(false);
    await userEvent.click(screen.getByRole("radio", { name: /A paired server/ }));
    await press("Continue");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "Address" }), "crew.example.ts.net");
    await userEvent.type(screen.getByRole("textbox", { name: "Pairing code" }), "ABCD2345");
    await press("Continue");
    expect(await within(screen.getByRole("list", { name: "Set up" })).findByText("Paired with crew.example.ts.net")).toBeInTheDocument();
    expect(desktop.of("crew_server_add")).toEqual([{ kind: "url", target: "crew.example.ts.net", code: "ABCD2345" }]);
    await press("Continue");
    await press("Skip");
    expect(desktop.of("crew_server_open")).toEqual([{ id: "url:crew.example.ts.net" }]);
  });

  it("offers the SSH hosts of the config and refuses a target with options", async () => {
    const desktop = new FakeDesktop();
    desktop.hosts = ["box", "gpu"];
    start(false, desktop);
    await userEvent.click(screen.getByRole("radio", { name: /over SSH/ }));
    await press("Continue");
    const host = screen.getByRole("combobox", { name: "SSH host" });
    await userEvent.click(host);
    expect(await screen.findByRole("option", { name: "gpu" })).toBeInTheDocument();
    await userEvent.type(host, "-oProxyCommand=sh");
    expect(screen.getByRole("alert")).toHaveTextContent("Type a host name");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await userEvent.clear(host);
    await userEvent.type(host, "gpu");
    await press("Continue");
    expect(await within(screen.getByRole("list", { name: "Set up" })).findByText("crew set up on gpu")).toBeInTheDocument();
    expect(desktop.of("crew_server_add")).toEqual([{ kind: "ssh", target: "gpu", code: "" }]);
  });

  it("shows why the set up failed and lets you try again", async () => {
    const desktop = new FakeDesktop();
    desktop.failures.crew_server_add = "Could not log in to box without a password";
    start(false, desktop);
    await userEvent.click(screen.getByRole("radio", { name: /over SSH/ }));
    await press("Continue");
    await userEvent.type(screen.getByRole("combobox", { name: "SSH host" }), "box");
    await press("Continue");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not log in to box without a password");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    delete desktop.failures.crew_server_add;
    await press("Try again");
    expect(await screen.findByText("crew set up on box")).toBeInTheDocument();
    await press("Back");
    expect(screen.getByRole("combobox", { name: "SSH host" })).toBeInTheDocument();
  });

  it("does not say that nothing needs sudo", async () => {
    start();
    expect(screen.getByText("The next steps pick where agents run, set that computer up and add a workspace.")).toBeInTheDocument();
    expect(screen.queryByText(/sudo/)).toBeNull();
    await press("Get started");
    await userEvent.click(screen.getByRole("radio", { name: /This computer/ }));
    await press("Continue");
    expect(screen.queryByText(/sudo/)).toBeNull();
  });

  async function sshTo(desktop: FakeDesktop, target: string) {
    start(false, desktop);
    await userEvent.click(screen.getByRole("radio", { name: /over SSH/ }));
    await press("Continue");
    await userEvent.type(screen.getByRole("combobox", { name: "SSH host" }), target);
    await press("Continue");
  }

  it("upgrades an older crew on the SSH host before it pairs", async () => {
    const desktop = new FakeDesktop();
    desktop.handlers.crew_server_crew = () => ({ action: "upgrade", server: "v0.1.0-beta.2", app: "v0.1.0-beta.6" });
    await sshTo(desktop, "box");
    const checklist = screen.getByRole("list", { name: "Set up" });
    expect(await within(checklist).findByText("crew set up on box")).toBeInTheDocument();
    expect(within(checklist).getByText("crew v0.1.0-beta.2 on box is older than the app")).toBeInTheDocument();
    expect(within(checklist).getByText("Installed crew v0.1.0-beta.6 on box")).toBeInTheDocument();
    expect(desktop.calls.map((c) => c.cmd).filter((c) => c.startsWith("crew_server_") && c !== "crew_servers")).toEqual(["crew_server_crew", "crew_server_install", "crew_server_add"]);
    expect(desktop.of("crew_server_install")).toEqual([{ target: "box" }]);
  });

  it("does not install when the crew on the SSH host is current", async () => {
    const desktop = new FakeDesktop();
    desktop.handlers.crew_server_crew = () => ({ action: "current", server: "v0.1.0-beta.6", app: "v0.1.0-beta.6" });
    await sshTo(desktop, "box");
    expect(await screen.findByText("crew set up on box")).toBeInTheDocument();
    expect(screen.getByText("crew v0.1.0-beta.6 on box")).toBeInTheDocument();
    expect(desktop.of("crew_server_install")).toEqual([]);
  });

  it("stops with a clear text when the crew on the SSH host is newer than the app", async () => {
    const desktop = new FakeDesktop();
    desktop.failures.crew_server_crew = "crew on box is v0.2.0, newer than this app (v0.1.0-beta.6). Update the app.";
    await sshTo(desktop, "box");
    expect(await screen.findByRole("alert")).toHaveTextContent("Update the app");
    expect(desktop.of("crew_server_add")).toEqual([]);
  });
});
