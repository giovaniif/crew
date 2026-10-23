import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Servers } from "../servers";
import { FakeDesktop } from "../test/fake-desktop";
import { FirstRun } from "./FirstRun";

function start(welcome = true) {
  const desktop = new FakeDesktop();
  const onClose = vi.fn();
  render(<FirstRun servers={new Servers(desktop)} welcome={welcome} onClose={onClose} />);
  return { desktop, onClose };
}

const steps = () => within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem").map((li) => li.textContent);
const current = () => within(screen.getByRole("list", { name: "Steps" })).getByText((_, el) => el?.getAttribute("aria-current") === "step").textContent;
const press = (name: string) => userEvent.click(screen.getByRole("button", { name }));

describe("FirstRun", () => {
  it("sets up this computer without the Server step and opens it", async () => {
    const { desktop, onClose } = start();
    expect(current()).toBe("Welcome");
    await press("Get started");
    await userEvent.click(screen.getByRole("radio", { name: /This computer/ }));
    expect(steps()).toEqual(["Welcome", "Where agents run", "Set up", "Workspace", "Done"]);
    await press("Continue");
    expect(current()).toBe("Set up");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await press("Set up");
    expect(desktop.of("crew_server_fix")).toEqual([{ id: "local" }]);
    expect(await screen.findByText("This computer is set up.")).toBeInTheDocument();
    await press("Continue");
    expect(current()).toBe("Workspace");
    await userEvent.type(screen.getByRole("textbox", { name: "Workspace folder" }), "~/code/api");
    await press("Add workspace");
    expect(desktop.of("crew_server_workspace")).toEqual([{ id: "local", path: "~/code/api" }]);
    await press("Continue");
    expect(current()).toBe("Done");
    await press("Open crew");
    expect(desktop.of("crew_server_open")).toEqual([{ id: "local" }]);
    expect(onClose).toHaveBeenCalled();
  });

  it("pairs a remote crew serve with its address and code", async () => {
    const { desktop } = start(false);
    expect(current()).toBe("Where agents run");
    await userEvent.click(screen.getByRole("radio", { name: /crew serve/ }));
    await press("Continue");
    expect(current()).toBe("Server");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "Address" }), "crew.example.ts.net");
    await userEvent.type(screen.getByRole("textbox", { name: "Pairing code" }), "ABCD2345");
    await press("Continue");
    await press("Set up");
    expect(desktop.of("crew_server_add")).toEqual([{ kind: "url", target: "crew.example.ts.net", code: "ABCD2345" }]);
    expect(await screen.findByText("crew.example.ts.net is set up.")).toBeInTheDocument();
    await press("Continue");
    await press("Continue");
    await press("Open crew");
    expect(desktop.of("crew_server_open")).toEqual([{ id: "url:crew.example.ts.net" }]);
  });

  it("offers the SSH hosts of the config and refuses a target with options", async () => {
    const desktop = new FakeDesktop();
    desktop.hosts = ["box", "gpu"];
    render(<FirstRun servers={new Servers(desktop)} welcome={false} onClose={() => undefined} />);
    await userEvent.click(screen.getByRole("radio", { name: /SSH/ }));
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
    await press("Set up");
    expect(desktop.of("crew_server_add")).toEqual([{ kind: "ssh", target: "gpu", code: "" }]);
  });

  it("shows why the set up failed and lets you try again", async () => {
    const desktop = new FakeDesktop();
    desktop.failures.crew_server_add = "Could not log in to box without a password";
    render(<FirstRun servers={new Servers(desktop)} welcome={false} onClose={() => undefined} />);
    await userEvent.click(screen.getByRole("radio", { name: /SSH/ }));
    await press("Continue");
    await userEvent.type(screen.getByRole("combobox", { name: "SSH host" }), "box");
    await press("Continue");
    await press("Set up");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not log in to box without a password");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    delete desktop.failures.crew_server_add;
    await press("Try again");
    expect(await screen.findByText("box is set up.")).toBeInTheDocument();
    await press("Back");
    expect(current()).toBe("Server");
  });
});
