import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { identity, mount, posts, type FakeMachine } from "../test/mates-env";

const mac: FakeMachine = { id: "m-mac", name: "mac", identities: [identity("yours")], mates: [{ name: "ada", prompt: "Review.", agent: "claude", enabled: true }] };
const devbox: FakeMachine = {
  id: "m-devbox",
  name: "devbox",
  identities: [identity("yours"), identity("work-bot")],
  mates: [{ name: "ada", prompt: "Other.", agent: "codex", enabled: true }],
};

describe("CopyMate (frame 12g)", () => {
  it("copies a mate from the ⋯ menu with mate.export and mate.import, and the original stays", async () => {
    const { servers } = mount({ hash: "#/mates/ada", desktop: true, machines: [mac, devbox] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "More for ada" }));
    await user.click(await screen.findByRole("menuitem", { name: "Copy to another machine…" }));
    const dialog = await screen.findByRole("dialog", { name: "Copy ada to another machine" });
    expect(within(dialog).getByText(/crew makes a new mate on the target machine with the same role, memory and look\. ada stays on This Mac and keeps its threads\./)).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Target machine" })).toHaveTextContent("devbox"));
    expect(within(dialog).getByRole("combobox", { name: "Environment on devbox" })).toHaveTextContent("devbox · your accounts");
    const name = within(dialog).getByRole("textbox", { name: "Name" });
    expect(name).toHaveValue("ada-2");
    expect(within(dialog).getByText("ada is taken on devbox.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("combobox", { name: "Environment on devbox" }));
    await user.click(await screen.findByRole("option", { name: "devbox · work-bot" }));
    await user.click(within(dialog).getByRole("button", { name: "Copy ada" }));
    expect(await screen.findByText("Copied as ada-2 on devbox.")).toBeInTheDocument();
    const local = servers.get("local")!;
    expect(local.calls.some((c) => c.method === "GET" && c.path === "/api/v1/mates/ada/export")).toBe(true);
    expect(posts(servers.get("ssh:devbox")!, "/api/v1/mates/import").at(-1)).toEqual({
      export: { mate: expect.objectContaining({ name: "ada-2", prompt: "Review." }), memory: "- Tests first." },
      environment: { machine_id: "m-devbox", identity_id: "work-bot" },
    });
    expect(local.calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("offers the copy in the open picker of the rail", async () => {
    mount({ hash: "#/mates/ada", desktop: true, machines: [mac, devbox] });
    const user = userEvent.setup();
    const rail = await screen.findByRole("complementary", { name: "Settings of ada" });
    await user.click(await within(rail).findByRole("button", { name: /^Environment:/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Copy ada to another machine…" }));
    expect(await screen.findByRole("dialog", { name: "Copy ada to another machine" })).toBeInTheDocument();
  });
});
