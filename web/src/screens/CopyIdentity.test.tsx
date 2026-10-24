import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { identity, mount, posts, type FakeMachine } from "../test/mates-env";

const mac: FakeMachine = {
  id: "m-mac",
  name: "mac",
  identities: [identity("yours"), identity("work-bot", { parts: ["git", "ssh", "github", "claude"], secrets: [{ name: "GH_TOKEN", set: true }, { name: "LINEAR_API_KEY", set: true }] })],
  mates: [{ name: "ada", prompt: "R.", agent: "claude", enabled: true }],
};
const devbox: FakeMachine = { id: "m-devbox", name: "devbox", identities: [identity("yours")], mates: [{ name: "rex", prompt: "R.", agent: "claude", enabled: true }] };

describe("CopyIdentity (frames 11g, 11h)", () => {
  it("runs copy_begin, export and import, and shows the new public key", async () => {
    const { servers } = mount({ hash: "#/envs/local/work-bot", desktop: true, machines: [mac, devbox] });
    const source = servers.get("local")!;
    const target = servers.get("ssh:devbox")!;
    target.on("POST", "/api/v1/identities/copy/begin", { status: 200, body: { copy_id: "c1", public_key: "PUBKEY" } });
    source.on("POST", "/api/v1/identities/work-bot/export", { status: 200, body: { bundle: "SEALED" } });
    target.on("POST", "/api/v1/identities/copy/c1", {
      status: 200,
      body: { name: "work-bot", kind: "custom", parts: ["git", "ssh", "github", "claude"], secrets: [{ name: "GH_TOKEN", set: true }], used_by: [], public_key: "ssh-ed25519 AAAATESTNEW work-bot@devbox", git_name: "work-bot", git_email: "bot@example.com" },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Copy to another machine…" }));
    const dialog = await screen.findByRole("dialog", { name: "Copy work-bot to another machine" });
    expect(within(dialog).getByText("crew makes a new identity on the target machine. The original on This Mac does not change.")).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Target machine" })).toHaveTextContent("devbox"));
    expect(within(dialog).getByText("Git name and email: copied")).toBeInTheDocument();
    expect(within(dialog).getByText("GitHub token, Claude key, secret variables: copied")).toBeInTheDocument();
    expect(within(dialog).getByText("SSH key: devbox makes a new key. Add it to GitHub after the copy.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Copy" }));
    expect(await screen.findByText("ssh-ed25519 AAAATESTNEW work-bot@devbox")).toBeInTheDocument();
    expect(posts(target, "/api/v1/identities/copy/begin")).toHaveLength(1);
    expect(posts(source, "/api/v1/identities/work-bot/export")).toEqual([{ public_key: "PUBKEY" }]);
    expect(posts(target, "/api/v1/identities/copy/c1")).toEqual([{ bundle: "SEALED" }]);
    const done = screen.getByRole("dialog", { name: "work-bot" });
    expect(within(done).getByText("on devbox · copied from This Mac")).toBeInTheDocument();
    expect(within(done).getByText("New ed25519 key on devbox")).toBeInTheDocument();
    expect(within(done).getByRole("button", { name: "Copy public key" })).toBeInTheDocument();
    expect(within(done).getByText(/Add this key to the GitHub account of work-bot\. Until then, mates on devbox with work-bot cannot push over SSH\./)).toBeInTheDocument();
    expect(within(done).getByText("COPIED FROM THIS MAC")).toBeInTheDocument();
    expect(within(done).getByText("work-bot · bot@example.com")).toBeInTheDocument();
    await user.click(within(done).getByRole("button", { name: "I added it" }));
    await waitFor(() => expect(window.location.hash).toBe("#/envs/ssh%3Adevbox/work-bot"));
  });

});
