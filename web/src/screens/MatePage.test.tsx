import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { identity, mount, posts, type FakeMachine } from "../test/mates-env";

const mac = (env?: string, agent = "claude"): FakeMachine => ({
  id: "m-mac",
  name: "mac",
  identities: [identity("yours"), identity("oncall")],
  mates: [{ name: "ada", prompt: "Review.", agent, env, enabled: true }],
});

const devbox = (env?: string, agent = "claude", extra: Partial<FakeMachine> = {}): FakeMachine => ({
  id: "m-devbox",
  name: "devbox",
  identities: [identity("yours"), identity("work-bot", { parts: ["git", "ssh", "codex"] })],
  mates: [{ name: "ada", prompt: "Review.", agent, env, enabled: true }],
  found: { git_name: "Giovani", github_user: "owner" },
  ...extra,
});

async function rail() {
  return screen.findByRole("complementary", { name: "Settings of ada" });
}

describe("MatePage environment rail (frame 12e)", () => {
  it("shows Your accounts on a server with the found login", async () => {
    mount({ hash: "#/mates/ada", host: "devbox.example.ts.net", machines: [devbox()] });
    const r = await rail();
    expect(within(r).getByText("Where ada runs, and whose accounts it uses.")).toBeInTheDocument();
    const picker = await within(r).findByRole("button", { name: /^Environment:/ });
    await waitFor(() => expect(picker).toHaveTextContent("devbox · your accounts"));
    expect(picker).toHaveTextContent("Runs on devbox. Acts as you (Giovani, @owner).");
    expect(within(r).getByRole("link", { name: "Open environment" })).toHaveAttribute("href", "#/envs/yours");
  });

  it("shows a separate identity", async () => {
    mount({ hash: "#/mates/ada", host: "devbox.example.ts.net", machines: [devbox("work-bot")] });
    const picker = await within(await rail()).findByRole("button", { name: /^Environment:/ });
    await waitFor(() => expect(picker).toHaveTextContent("devbox · work-bot"));
    expect(picker).toHaveTextContent("Runs on devbox. Commits as work-bot.");
  });

  it("shows This Mac in the desktop app", async () => {
    mount({ hash: "#/mates/ada", desktop: true, machines: [mac()] });
    const picker = await within(await rail()).findByRole("button", { name: /^Environment:/ });
    await waitFor(() => expect(picker).toHaveTextContent("This Mac · your accounts"));
    expect(picker).toHaveTextContent("Runs on this Mac. Acts as you. Stops when the Mac sleeps.");
  });

  it("warns when the identity has no key for the harness of the mate", async () => {
    mount({ hash: "#/mates/ada", host: "devbox.example.ts.net", machines: [devbox("work-bot", "codex")] });
    const r = await rail();
    expect(await within(r).findByText(/work-bot has no Codex key, and ada uses Codex\./)).toBeInTheDocument();
    expect(within(r).getByRole("link", { name: "Set key" })).toHaveAttribute("href", "#/envs/work-bot");
  });

  it("says when the machine is not reachable", async () => {
    mount({ hash: "#/mates/ada", host: "ci-runner.example.ts.net", machines: [devbox(undefined, "claude", { down: true })] });
    const r = await rail();
    expect(await within(r).findByText(/ci-runner is not reachable\. ada cannot start a conversation\./)).toBeInTheDocument();
    expect(within(r).getByRole("link", { name: "Check connection" })).toBeInTheDocument();
  });

  it("lists only the identities of the machine of the mate and saves the pick", async () => {
    const { servers } = mount({ hash: "#/mates/ada", desktop: true, machines: [mac(), devbox()] });
    const user = userEvent.setup();
    const picker = await within(await rail()).findByRole("button", { name: /^Environment:/ });
    await waitFor(() => expect(picker).toHaveTextContent("This Mac · your accounts"));
    await user.click(picker);
    const menu = await screen.findByRole("menu", { name: "Environment" });
    expect(within(menu).getByText("This Mac")).toBeInTheDocument();
    expect(within(menu).queryByText("devbox")).toBeNull();
    expect(within(menu).queryByRole("menuitemcheckbox", { name: /work-bot/ })).toBeNull();
    expect(within(menu).getByRole("menuitemcheckbox", { name: /Your accounts/ })).toHaveAttribute("aria-checked", "true");
    expect(within(menu).getByRole("menuitem", { name: "+ Separate identity on This Mac…" })).toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitemcheckbox", { name: /oncall/ }));
    await waitFor(() =>
      expect(posts(servers.get("local")!, "/api/v1/mates").at(-1)).toMatchObject({
        mate: { name: "ada" },
        environment: { machine_id: "m-mac", identity_id: "oncall" },
      }),
    );
  });

  it("never uses the words Local, Custom or Servers", async () => {
    mount({ hash: "#/mates/ada", desktop: true, machines: [mac()] });
    const r = await rail();
    await waitFor(() => expect(within(r).getByRole("button", { name: /^Environment:/ })).toHaveTextContent("This Mac"));
    expect(r.textContent).not.toMatch(/\b(Local|Custom|Servers)\b/);
  });
});
