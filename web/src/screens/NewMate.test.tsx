import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { identity, mount, posts, type FakeMachine } from "../test/mates-env";

const mac: FakeMachine = { id: "m-mac", name: "mac", identities: [identity("yours"), identity("oncall")], mates: [{ name: "ada", prompt: "R.", agent: "claude", enabled: true }] };
const devbox: FakeMachine = { id: "m-devbox", name: "devbox", identities: [identity("yours"), identity("work-bot")], mates: [] };
const ci: FakeMachine = { id: "m-ci", name: "ci-runner", identities: [identity("yours")], mates: [], down: true };

async function fill() {
  const user = userEvent.setup();
  await user.type(await screen.findByRole("textbox", { name: "Name" }), "nova");
  await user.type(screen.getByRole("textbox", { name: "Role" }), "Review.");
  return user;
}

describe("NewMate environment menu (frame 12d)", () => {
  it("groups the environments by machine and marks a machine that is not reachable", async () => {
    mount({ hash: "#/mates/new", desktop: true, machines: [mac, devbox, ci] });
    const user = await fill();
    const chip = await screen.findByRole("button", { name: /^Environment:/ });
    await waitFor(() => expect(chip).toHaveTextContent("This Mac · your accounts"));
    await user.click(chip);
    const menu = await screen.findByRole("menu", { name: "Environment" });
    expect(within(menu).getByLabelText("Search environments")).toBeInTheDocument();
    const labels = Array.from(menu.querySelectorAll(".menu-label")).map((l) => l.textContent);
    expect(labels).toEqual(["This Mac", "devbox", "ci-runner · not reachable"]);
    expect(within(menu).getAllByRole("menuitemcheckbox", { name: /Your accounts/ })).toHaveLength(3);
    expect(within(menu).getByRole("menuitemcheckbox", { name: /work-bot/ })).toHaveTextContent("identity");
    const offline = within(menu).getAllByRole("menuitemcheckbox", { name: /Your accounts/ })[2];
    expect(offline).toHaveAttribute("aria-disabled", "true");
    expect(offline).toHaveTextContent("offline");
    expect(within(menu).getByRole("menuitem", { name: "+ Separate identity…" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "+ Connect a server…" })).toBeInTheDocument();
    expect(menu.textContent).not.toMatch(/\b(Local|Custom|Servers)\b/);
  });

  it("creates the mate on the machine of the picked environment", async () => {
    const { servers } = mount({ hash: "#/mates/new", desktop: true, machines: [mac, devbox] });
    const user = await fill();
    const chip = await screen.findByRole("button", { name: /^Environment:/ });
    await waitFor(() => expect(chip).toHaveTextContent("This Mac"));
    await user.click(chip);
    await user.click(within(await screen.findByRole("menu", { name: "Environment" })).getByRole("menuitemcheckbox", { name: /work-bot/ }));
    expect(chip).toHaveTextContent("devbox · work-bot");
    await user.click(screen.getByRole("button", { name: "Create mate" }));
    await waitFor(() =>
      expect(posts(servers.get("ssh:devbox")!, "/api/v1/mates").at(-1)).toMatchObject({
        mate: { name: "nova" },
        environment: { machine_id: "m-devbox", identity_id: "work-bot" },
      }),
    );
    expect(posts(servers.get("local")!, "/api/v1/mates")).toEqual([]);
  });
});
