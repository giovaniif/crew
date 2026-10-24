import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { desktop, goldenState } from "../test/desktop";
import { FakeDesktop } from "../test/fake-desktop";
import type { FakeServer } from "../test/fake-server";

afterEach(() => {
  window.location.hash = "";
});

const found = { git_name: "TEST Owner", git_email: "", ssh_agent: true, ssh_keys: 1, github: true, github_user: "owner", claude: true, codex: false, pi: false };
const yours = { name: "yours", kind: "local", parts: [], secrets: [], used_by: [] };
const bot = { name: "test-bot", kind: "custom", parts: ["git", "ssh", "github"], secrets: [], used_by: [] };

const routes = (server: FakeServer) =>
  server
    .on("GET", "/api/v1/mates", { status: 200, body: { mates: [], limits: { hop_limit: 0, turns_per_hour: 0, daily_turns: 0, daily_tokens: 0, stop: false } } })
    .on("GET", "/api/v1/envs", { status: 200, body: { envs: [] } })
    .on("GET", "/api/v1/environments", { status: 200, body: { machine: { id: "m-devbox", name: "devbox" }, identities: [yours, bot], found } })
    .on("GET", "/api/v1/approvals", { status: 200, body: [] })
    .on("POST", "/api/v1/mates", (call) => ({ status: 200, body: (call.body as { mate: unknown }).mate }));

function saved(server: FakeServer) {
  return server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/mates")?.body as { mate: Record<string, unknown>; environment?: unknown };
}

async function toMate() {
  fireEvent.click(await screen.findByRole("button", { name: "Next: make a mate" }));
}

describe("the first run of mates on a server", () => {
  it("has no This Mac and starts with the machine as an environment (12b)", async () => {
    const { live } = desktop("#/mates", true, undefined, {}, routes);
    live();
    expect(await screen.findByRole("heading", { name: "devbox is ready" })).toBeInTheDocument();
    expect(screen.getByText("crew runs on devbox now. It found your logins there, so this environment is ready to use.")).toBeInTheDocument();
    const card = screen.getByRole("group", { name: "devbox · your accounts" });
    expect(card).toHaveTextContent("New environment");
    expect(card).toHaveTextContent("connected");
    expect(within(card).getByText("git: TEST Owner")).toHaveClass("set-y");
    expect(within(card).getByText("gh @owner")).toHaveClass("set-y");
    expect(within(card).getByText("Codex")).toHaveClass("set-n");
    expect(card).toHaveTextContent("Mates in this environment act as you on devbox. To use a bot account, add a separate identity later in Environments.");
    expect(document.body.textContent).not.toMatch(/This Mac|Local|Custom|Servers/);
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("makes the first mate with the environment already picked (12c)", async () => {
    const { live, server } = desktop("#/mates", true, undefined, {}, routes);
    live();
    await toMate();
    expect(screen.getByRole("heading", { name: "Make your first mate" })).toBeInTheDocument();
    expect(screen.getByText("A mate is an agent that stays: a name, a role and one conversation.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Environment" })).toHaveTextContent("devbox · your accounts");
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "test-ada" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Role" }), { target: { value: "Review PRs." } });
    expect(screen.getByText("test-ada runs on devbox and commits as TEST Owner.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create test-ada" }));
    await waitFor(() => expect(window.location.hash).toBe("#/mates/test-ada"));
    const body = saved(server);
    expect(body.mate).toMatchObject({ name: "test-ada", agent: "claude", prompt: "Review PRs.", enabled: true });
    expect(body.environment).toEqual({ machine_id: "m-devbox", identity_id: "yours" });
  });

  it("offers the separate identities of the same machine", async () => {
    const { live, server } = desktop("#/mates", true, undefined, {}, routes);
    live();
    await toMate();
    fireEvent.click(screen.getByRole("combobox", { name: "Environment" }));
    fireEvent.click(screen.getByRole("option", { name: "devbox · test-bot" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "test-ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Create test-ada" }));
    await waitFor(() => expect(window.location.hash).toBe("#/mates/test-ada"));
    expect(saved(server).environment).toEqual({ machine_id: "m-devbox", identity_id: "test-bot" });
  });

  it("goes back to the machine with Back", async () => {
    const { live } = desktop("#/mates", true, undefined, {}, routes);
    live();
    await toMate();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "devbox is ready" })).toBeInTheDocument();
  });

  it("shows a face and the saved slug for a name with spaces and capitals", async () => {
    const { live } = desktop("#/mates", true, undefined, {}, routes);
    live();
    await toMate();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "UX Patrol" } });
    expect(screen.getByRole("button", { name: "Change face" })).toBeInTheDocument();
    expect(screen.getByText("Saved as ux-patrol")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create ux-patrol" })).toBeEnabled();
  });

  it("tells why a name is refused next to the field", async () => {
    const { live } = desktop("#/mates", true, undefined, {}, routes);
    live();
    await toMate();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "!!!" } });
    expect(screen.getByText("Use up to 32 letters, digits, - and _.")).toBeInTheDocument();
  });

  it("picks the face and the color from a click on the face", async () => {
    const { live, server } = desktop("#/mates", true, undefined, {}, routes);
    live();
    await toMate();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "test-ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Change face" }));
    const picker = screen.getByRole("dialog", { name: "Face and color" });
    fireEvent.click(within(picker).getByRole("button", { name: "Owl" }));
    fireEvent.click(within(picker).getByRole("button", { name: "Color #40a02b" }));
    fireEvent.click(within(picker).getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Create test-ada" }));
    await waitFor(() => expect(window.location.hash).toBe("#/mates/test-ada"));
    expect(saved(server).mate).toMatchObject({ avatar: "owl", color: "#40a02b" });
  });

  it("does not show the first run while mates exist", () => {
    const { live } = desktop("#/mates", true, undefined, {}, routes);
    live({ ...goldenState(), mates: { stopped: false, mates: [{ name: "rex", state: "ready", work: [], threads: [] }] } });
    expect(screen.queryByRole("heading", { name: "devbox is ready" })).not.toBeInTheDocument();
  });

  it("offers a plain session instead and then shows the Mates home", async () => {
    const { live } = desktop("#/mates", true, undefined, {}, routes);
    live();
    const link = await screen.findByRole("link", { name: "Start a session" });
    expect(link).toHaveAttribute("href", "#/new");
    fireEvent.click(link);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "devbox is ready" })).not.toBeInTheDocument());
    window.location.hash = "#/mates";
    await waitFor(() => expect(screen.getByRole("heading", { name: "Mates" })).toBeInTheDocument());
  });

  it("asks for the name, the harness and the environment on one phone step", async () => {
    const { live, server } = desktop("#/mates", false, undefined, {}, routes);
    live();
    expect(screen.getByRole("heading", { name: "Make your first mate" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Harness" })).toHaveTextContent("Claude");
    expect(await screen.findByRole("combobox", { name: "Environment" })).toHaveTextContent("devbox · your accounts");
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "test-ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(window.location.hash).toBe("#/mates/test-ada"));
    expect(saved(server).environment).toEqual({ machine_id: "m-devbox", identity_id: "yours" });
  });
});

function answers(app: FakeDesktop) {
  app.handlers.crew_machine_request = (args) => {
    const id = String(args?.machineId);
    const name = id === "local" ? "mac" : id.replace(/^ssh:/, "");
    const path = String(args?.path);
    const body =
      path === "/api/v1/environments"
        ? { machine: { id: "m-" + name, name }, identities: [yours], found }
        : path === "/api/v1/mates" && args?.method === "POST"
          ? JSON.parse(String(args?.body)).mate
          : path === "/api/v1/mates"
            ? { mates: [] }
            : [];
    return { status: 200, body: JSON.stringify(body) };
  };
  return app;
}

describe("the first run of mates in the desktop app", () => {
  it("asks where crew runs the mates, with This Mac and a server over SSH (12a)", async () => {
    const app = answers(new FakeDesktop());
    const { live } = desktop("#/mates", true, undefined, { desktop: app }, routes);
    live();
    expect(await screen.findByRole("heading", { name: "Where does crew run your mates?" })).toBeInTheDocument();
    expect(screen.getByText("Pick the machine. Mates on a server keep working when this Mac sleeps.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /This Mac/ })).toHaveTextContent("Mates stop when the Mac sleeps.");
    expect(screen.getByRole("radio", { name: /A server over SSH/ })).toHaveTextContent("A Linux box or VM that you can SSH to.");
  });

  it("uses This Mac and makes the mate there", async () => {
    const app = answers(new FakeDesktop());
    const { live } = desktop("#/mates", true, undefined, { desktop: app }, routes);
    live();
    fireEvent.click(await screen.findByRole("radio", { name: /This Mac/ }));
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("heading", { name: "This Mac is ready" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "This Mac · your accounts" })).toBeInTheDocument();
    await toMate();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "test-ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Create test-ada" }));
    await waitFor(() => expect(window.location.hash).toBe("#/mates/test-ada"));
    const post = app.of("crew_machine_request").find((a) => a?.method === "POST");
    expect(post?.machineId).toBe("local");
    expect(JSON.parse(String(post?.body)).environment).toEqual({ machine_id: "m-mac", identity_id: "yours" });
  });

  it("connects a server over SSH and makes it the environment (12a, 12b)", async () => {
    const app = answers(new FakeDesktop());
    const { live } = desktop("#/mates", true, undefined, { desktop: app }, routes);
    live();
    fireEvent.click(await screen.findByRole("radio", { name: /A server over SSH/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "SSH host" }), { target: { value: "devbox" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("heading", { name: "devbox is ready" })).toBeInTheDocument();
    expect(app.of("crew_server_add")).toEqual([{ kind: "ssh", target: "devbox", code: "" }]);
    expect(screen.getByRole("group", { name: "devbox · your accounts" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Where does crew run your mates?" })).toBeInTheDocument();
  });

  it("fills the window with no sidebar until the first run is skipped", async () => {
    const app = answers(new FakeDesktop());
    const { live } = desktop("#/mates", true, undefined, { desktop: app }, routes);
    live();
    await screen.findByRole("heading", { name: "Where does crew run your mates?" });
    expect(screen.queryByRole("navigation", { name: "Sidebar" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Start a session" }));
    expect(await screen.findByRole("navigation", { name: "Sidebar" })).toBeInTheDocument();
  });

  it("asks for an SSH host, not a command", async () => {
    const app = answers(new FakeDesktop());
    const { live } = desktop("#/mates", true, undefined, { desktop: app }, routes);
    live();
    fireEvent.click(await screen.findByRole("radio", { name: /A server over SSH/ }));
    const field = screen.getByRole("textbox", { name: "SSH host" });
    expect(field).toHaveAttribute("placeholder", "user@host or server");
    expect(screen.getByText("Type the host as for ssh: user@host or a Host alias of ~/.ssh/config. Do not type the ssh command.")).toBeInTheDocument();
  });

  it("removes a leading ssh from a pasted command", async () => {
    const app = answers(new FakeDesktop());
    const { live } = desktop("#/mates", true, undefined, { desktop: app }, routes);
    live();
    fireEvent.click(await screen.findByRole("radio", { name: /A server over SSH/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "SSH host" }), { target: { value: "ssh devbox" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("heading", { name: "devbox is ready" })).toBeInTheDocument();
    expect(app.of("crew_server_add")).toEqual([{ kind: "ssh", target: "devbox", code: "" }]);
  });
});
