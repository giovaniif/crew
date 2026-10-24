import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { EnvInfo } from "../api";
import { desktop } from "../test/desktop";
import { FakeDesktop } from "../test/fake-desktop";
import type { FakeServer } from "../test/fake-server";

afterEach(() => {
  window.location.hash = "";
});

const local: EnvInfo = { name: "local", kind: "local", parts: [], secrets: [{ name: "LINEAR_API_KEY", set: true }], used_by: ["ada", "june"] };
const work: EnvInfo = {
  name: "test-work",
  kind: "custom",
  parts: ["git", "ssh", "github", "claude", "codex", "pi"],
  secrets: [
    { name: "GH_TOKEN", set: true },
    { name: "CLAUDE_CODE_OAUTH_TOKEN", set: true },
    { name: "ANTHROPIC_API_KEY", set: false },
    { name: "OPENAI_API_KEY", set: true },
    { name: "GEMINI_API_KEY", set: false },
    { name: "SENTRY_TOKEN", set: true },
  ],
  public_key: "ssh-ed25519 AAAATESTOLD crew-test-work",
  used_by: ["rex", "milo"],
};
const sandbox: EnvInfo = { name: "test-sandbox", kind: "custom", parts: ["github"], secrets: [{ name: "GH_TOKEN", set: false }], used_by: [] };

const found = { git_name: "TEST Owner", git_email: "", ssh_agent: false, ssh_keys: 1, github: true, github_user: "owner", claude: true, codex: false, pi: false };

function routes(server: FakeServer) {
  server
    .on("GET", "/api/v1/environments", { status: 200, body: { machine: { id: "m-devbox", name: "devbox" }, identities: [local, work, sandbox], found } })
    .on("GET", "/api/v1/envs", { status: 200, body: { envs: [local, work, sandbox] } })
    .on("GET", "/api/v1/envs/test-work", { status: 200, body: work })
    .on("GET", "/api/v1/envs/local", { status: 200, body: local })
    .on("GET", "/api/v1/envs/test-sandbox", { status: 200, body: sandbox });
}

function open(hash: string, wide = true, more: (s: FakeServer) => void = () => undefined) {
  const d = desktop(hash, wide, undefined, {}, (s) => {
    routes(s);
    more(s);
  });
  d.live();
  return d;
}

describe("the environments page", () => {
  it("is in the sidebar between Automations and Disk, and on the phone More page", async () => {
    open("#/sessions");
    const nav = screen.getByRole("navigation", { name: "Sidebar" });
    const labels = within(nav)
      .getAllByRole("link")
      .map((a) => a.textContent ?? "");
    const at = labels.findIndex((l) => l.endsWith("Environments"));
    expect(labels[at - 1]).toMatch(/Automations$/);
    expect(labels[at + 1]).toMatch(/Disk$/);
    expect(within(nav).getByRole("link", { name: "Environments" })).toHaveAttribute("href", "#/envs");
  });

  it("marks only Environments as the current nav item", async () => {
    open("#/envs");
    const nav = screen.getByRole("navigation", { name: "Sidebar" });
    expect(within(nav).getByRole("link", { name: "Environments" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: /Sessions/ })).not.toHaveAttribute("aria-current");
  });

  it("marks only Mates as the current nav item on a mate page", async () => {
    open("#/mates/rex");
    const nav = screen.getByRole("navigation", { name: "Sidebar" });
    expect(within(nav).getByRole("link", { name: /Sessions/ })).not.toHaveAttribute("aria-current");
  });

  it("shows the Claude account with Replace and no Remove", async () => {
    open("#/envs/this/test-work");
    const claude = await screen.findByRole("group", { name: "Claude" });
    expect(within(claude).getByRole("button", { name: "Replace" })).toBeInTheDocument();
    expect(within(claude).queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("lists the machine, then Your accounts and each separate identity under it", async () => {
    open("#/envs");
    const list = await screen.findByRole("list", { name: "Environments" });
    await waitFor(() => expect(within(list).getAllByRole("link").length).toBe(4));
    const rows = within(list).getAllByRole("link");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("devbox"),
      expect.stringContaining("Your accountsada, june"),
      expect.stringContaining("test-workSeparate identity · 2 mates"),
      expect.stringContaining("test-sandboxSeparate identity"),
    ]);
    expect(rows[0]).toHaveAttribute("aria-current", "page");
    expect(document.body.textContent).not.toMatch(/Local|Custom|Servers/);
  });

  it("shows the selected machine with its connection, the found logins and its separate identities (11a)", async () => {
    open("#/envs/this");
    expect(await screen.findByRole("heading", { name: "devbox" })).toBeInTheDocument();
    expect(screen.getByText("connected")).toBeInTheDocument();
    expect(screen.getByText("CONNECTION")).toBeInTheDocument();
    expect(await screen.findByRole("group", { name: "crew on devbox" })).toHaveTextContent("running · v0.12.0+abc");
    expect(screen.getByText("YOUR ACCOUNTS ON DEVBOX")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Git identity" })).toHaveTextContent("TEST Owner · from ~/.gitconfig on devbox");
    expect(screen.getByRole("group", { name: "SSH" })).toHaveTextContent("1 key in ~/.ssh on devbox");
    expect(screen.getByRole("group", { name: "Codex" })).toHaveTextContent("not found");
    expect(screen.getByText("SEPARATE IDENTITIES ON DEVBOX")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Own git name, SSH key and tokens · rex, milo/ })).toHaveAttribute("href", "#/envs/this/test-work");
    expect(screen.getByRole("button", { name: "+ Separate identity" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Local|Custom|Servers/);
  });

  it("on the phone groups the identities by machine and opens the machine detail (11e, 11f)", async () => {
    open("#/envs", false);
    const group = await screen.findByRole("group", { name: "devbox" });
    expect(group).toHaveTextContent("connected");
    expect(within(group).getByRole("link", { name: /Your accounts/ })).toHaveAttribute("href", "#/envs/this/local");
    expect(within(group).getByRole("link", { name: /devbox/ })).toHaveAttribute("href", "#/envs/this");
    expect(screen.getByText("An environment is a machine and the accounts a mate uses on it.")).toBeInTheDocument();
  });

  it("shows the machine detail on the phone (11f)", async () => {
    open("#/envs/this", false);
    expect(await screen.findByRole("heading", { name: "devbox" })).toBeInTheDocument();
    expect(screen.getByText("SEPARATE IDENTITIES")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /test-work · rex, milo/ })).toHaveAttribute("href", "#/envs/this/test-work");
    expect(screen.getByRole("button", { name: "+ Separate identity" })).toBeInTheDocument();
  });

  it("shows a custom environment with secrets as set or not set and the public key", async () => {
    open("#/envs/this/test-work");
    expect(await screen.findByRole("heading", { name: "test-work" })).toBeInTheDocument();
    expect(screen.getByText("Separate identity", { selector: ".pill" })).toBeInTheDocument();
    expect(screen.getByText("on devbox")).toBeInTheDocument();
    expect(screen.getByText(/Mates with this environment run on devbox, but not as you/)).toBeInTheDocument();
    expect(screen.getByText("2 mates")).toBeInTheDocument();
    expect(screen.getByText("ssh-ed25519 AAAATESTOLD crew-test-work")).toBeInTheDocument();
    const pi = screen.getByRole("group", { name: "Pi" });
    expect(pi).toHaveTextContent("not set");
    expect(within(pi).getByRole("button", { name: "Set…" })).toBeInTheDocument();
    const codex = screen.getByRole("group", { name: "Codex" });
    expect(codex).toHaveTextContent("set");
    expect(within(codex).getByRole("button", { name: "Replace" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "SENTRY_TOKEN" })).toHaveTextContent("set");
    expect(screen.queryByRole("group", { name: "GH_TOKEN" })).not.toBeInTheDocument();
  });

  it("sets a secret through a password dialog, sends it once and never shows it", async () => {
    const user = userEvent.setup();
    const after = { ...work, secrets: work.secrets.map((s) => (s.name === "GEMINI_API_KEY" ? { ...s, set: true } : s)) };
    const { server } = open("#/envs/this/test-work", true, (s) => s.on("POST", "/api/v1/envs/test-work", { status: 200, body: after }));
    await user.click(within(await screen.findByRole("group", { name: "Pi" })).getByRole("button", { name: "Set…" }));
    const dialog = screen.getByRole("dialog", { name: "Set Pi API key" });
    expect(dialog).toHaveTextContent("rex and milo use it from their next conversation.");
    const field = within(dialog).getByLabelText("Value");
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveValue("");
    await user.type(field, "TEST-secret-value");
    await user.click(within(dialog).getByRole("button", { name: "Save key" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const post = server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/envs/test-work");
    expect(post?.body).toEqual({ secret: expect.stringMatching(/_API_KEY$/), value: "TEST-secret-value" });
    expect(document.body.innerHTML).not.toContain("TEST-secret-value");
    expect(screen.getByText(/rex and milo get the change when their next conversation starts/)).toBeInTheDocument();
    await user.click(within(screen.getByRole("group", { name: "Pi" })).getByRole("button", { name: "Replace" }));
    expect(within(screen.getByRole("dialog")).getByLabelText("Value")).toHaveValue("");
  });

  it("removes a secret with unset", async () => {
    const user = userEvent.setup();
    const { server } = open("#/envs/this/test-work", true, (s) => s.on("POST", "/api/v1/envs/test-work/unset", { status: 200, body: work }));
    await user.click(within(await screen.findByRole("group", { name: "Codex" })).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(server.calls.some((c) => c.path === "/api/v1/envs/test-work/unset")).toBe(true));
    expect(server.calls.find((c) => c.path === "/api/v1/envs/test-work/unset")?.body).toEqual({ secret: "OPENAI_API_KEY" });
  });

  it("makes a new SSH key and keeps the old one until you confirm it is on GitHub", async () => {
    const user = userEvent.setup();
    const { server } = open("#/envs/this/test-work", true, (s) =>
      s.on("POST", "/api/v1/envs/test-work/ssh-key", (call) => {
        const action = (call.body as { action: string }).action;
        if (action === "rotate") {
          return { status: 200, body: { ...work, new_public_key: "ssh-ed25519 AAAATESTNEW crew-test-work" } };
        }
        return { status: 200, body: { ...work, public_key: "ssh-ed25519 AAAATESTNEW crew-test-work" } };
      }),
    );
    await user.click(await screen.findByRole("button", { name: "New key…" }));
    expect(await screen.findByText("ssh-ed25519 AAAATESTNEW crew-test-work")).toBeInTheDocument();
    expect(screen.getByText("waiting for you")).toBeInTheDocument();
    expect(screen.getByText(/in use until you confirm/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "I added it to GitHub" }));
    await waitFor(() => expect(screen.queryByText("waiting for you")).not.toBeInTheDocument());
    expect(server.calls.filter((c) => c.path === "/api/v1/envs/test-work/ssh-key").map((c) => (c.body as { action: string }).action)).toEqual(["rotate", "confirm"]);
  });

  it("cancels a new key: it posts cancel and the old key stays", async () => {
    const user = userEvent.setup();
    const { server } = open("#/envs/this/test-work", true, (s) =>
      s.on("POST", "/api/v1/envs/test-work/ssh-key", (call) => {
        const action = (call.body as { action: string }).action;
        return { status: 200, body: action === "rotate" ? { ...work, new_public_key: "ssh-ed25519 AAAATESTNEW crew-test-work" } : work };
      }),
    );
    await user.click(await screen.findByRole("button", { name: "New key…" }));
    await user.click(await screen.findByRole("button", { name: "Cancel new key" }));
    await waitFor(() => expect(screen.queryByText("waiting for you")).not.toBeInTheDocument());
    expect(screen.getByText("ssh-ed25519 AAAATESTOLD crew-test-work")).toBeInTheDocument();
    expect(server.calls.filter((c) => c.path === "/api/v1/envs/test-work/ssh-key").map((c) => (c.body as { action: string }).action)).toEqual(["rotate", "cancel"]);
  });

  it("shows a pending new key from the server after a reload", async () => {
    open("#/envs/this/test-work", true, (s) =>
      s.on("GET", "/api/v1/envs/test-work", { status: 200, body: { ...work, new_public_key: "ssh-ed25519 AAAATESTNEW crew-test-work" } }),
    );
    expect(await screen.findByText("ssh-ed25519 AAAATESTNEW crew-test-work")).toBeInTheDocument();
    expect(screen.getByText("waiting for you")).toBeInTheDocument();
  });

  it("shows the date of the SSH key", async () => {
    open("#/envs/this/test-work", true, (s) =>
      s.on("GET", "/api/v1/envs/test-work", { status: 200, body: { ...work, key_created: "2026-10-21T12:00:00Z" } }),
    );
    expect(await screen.findByText("· Oct 21")).toBeInTheDocument();
  });

  it("fills the git identity from the server", async () => {
    open("#/envs/this/test-work", true, (s) =>
      s.on("GET", "/api/v1/envs/test-work", { status: 200, body: { ...work, git_name: "TEST bot", git_email: "bot@example.com" } }),
    );
    expect(await screen.findByLabelText("Name")).toHaveValue("TEST bot");
    expect(screen.getByLabelText("Email")).toHaveValue("bot@example.com");
  });

  it("shows what crew found on this machine for Local, and how to log in", async () => {
    const user = userEvent.setup();
    open("#/envs/this/local", true, (s) =>
      s.on("GET", "/api/v1/envs/local", {
        status: 200,
        body: { ...local, local: { git_name: "TEST Owner", git_email: "owner@example.com", ssh_agent: true, ssh_keys: 2, github: true, github_user: "owner", claude: true, codex: true, pi: false } },
      }),
    );
    expect(await screen.findByRole("group", { name: "Git identity" })).toHaveTextContent("TEST Owner · from ~/.gitconfig");
    expect(screen.getByRole("group", { name: "SSH" })).toHaveTextContent("ssh-agent · 2 keys");
    expect(screen.getByRole("group", { name: "GitHub CLI" })).toHaveTextContent("logged in as @owner");
    expect(screen.getByRole("group", { name: "Claude" })).toHaveTextContent("logged in");
    expect(screen.getByRole("group", { name: "Codex" })).toHaveTextContent("logged in");
    const pi = screen.getByRole("group", { name: "Pi" });
    expect(pi).toHaveTextContent("not found");
    expect(within(screen.getByRole("group", { name: "Claude" })).queryByRole("button", { name: "How to log in" })).not.toBeInTheDocument();
    await user.click(within(pi).getByRole("button", { name: "How to log in" }));
    expect(within(pi).getByText("omp login")).toBeInTheDocument();
  });

  it("shows the Pi login command of a custom environment that has no Pi key", async () => {
    const user = userEvent.setup();
    open("#/envs/this/test-sandbox", true, (s) =>
      s.on("GET", "/api/v1/envs/test-sandbox", { status: 200, body: { ...sandbox, parts: ["pi"], secrets: [{ name: "ANTHROPIC_API_KEY", set: false }, { name: "OPENAI_API_KEY", set: false }] } }),
    );
    const pi = await screen.findByRole("group", { name: "Pi" });
    await user.click(within(pi).getByRole("button", { name: "How to log in" }));
    expect(within(pi).getByText("crew env login test-sandbox --harness omp")).toBeInTheDocument();
    expect(within(pi).getByText("crew env set test-sandbox ANTHROPIC_API_KEY")).toBeInTheDocument();
  });

  it("shows how to log in to a harness of a custom environment that has no login", async () => {
    const user = userEvent.setup();
    open("#/envs/this/test-sandbox", true, (s) =>
      s.on("GET", "/api/v1/envs/test-sandbox", { status: 200, body: { ...sandbox, parts: ["claude"], secrets: [{ name: "CLAUDE_CODE_OAUTH_TOKEN", set: false }, { name: "ANTHROPIC_API_KEY", set: false }] } }),
    );
    const claude = await screen.findByRole("group", { name: "Claude" });
    await user.click(within(claude).getByRole("button", { name: "How to log in" }));
    expect(within(claude).getByText("crew env login test-sandbox")).toBeInTheDocument();
  });

  it("shows Your accounts as read-only with extra variables and Make a separate identity from this… (11c)", async () => {
    const user = userEvent.setup();
    open("#/envs/this/local");
    expect(await screen.findByRole("heading", { name: "Your accounts on devbox" })).toBeInTheDocument();
    expect(screen.getByText("FOUND ON DEVBOX")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Local|Custom|Servers/);
    expect(screen.getByRole("link", { name: "ada, june", current: false })).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New key…" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "LINEAR_API_KEY" })).toHaveTextContent("set");
    await user.click(screen.getByRole("button", { name: "Make a separate identity from this…" }));
    expect(screen.getByRole("dialog", { name: "New separate identity on devbox" })).toBeInTheDocument();
  });

  it("creates a custom environment with all parts and a key, and opens it", async () => {
    const user = userEvent.setup();
    const made: EnvInfo = { ...sandbox, name: "test-new", used_by: [] };
    const { server } = open("#/envs/this/local", true, (s) =>
      s
        .on("POST", "/api/v1/envs", { status: 200, body: made })
        .on("POST", "/api/v1/envs/test-new/ssh-key", { status: 200, body: made })
        .on("GET", "/api/v1/envs/test-new", { status: 200, body: made }),
    );
    window.location.hash = "#/envs/this";
    await user.click(await screen.findByRole("button", { name: "+ Separate identity" }));
    const dialog = screen.getByRole("dialog", { name: "New separate identity on devbox" });
    await user.type(within(dialog).getByLabelText("Name"), "test-new");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(window.location.hash).toBe("#/envs/this/test-new"));
    expect(server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/envs")?.body).toEqual({
      name: "test-new",
      kind: "custom",
      parts: ["git", "ssh", "github", "claude", "codex", "pi"],
    });
    expect(server.calls.find((c) => c.path === "/api/v1/envs/test-new/ssh-key")?.body).toEqual({ action: "make" });
  });

  it("loads the list again when it opens an identity that another screen made", async () => {
    const made: EnvInfo = { ...sandbox, name: "test-new", used_by: [] };
    let identities: EnvInfo[] = [local, work, sandbox];
    open("#/envs/this", true, (s) =>
      s
        .on("GET", "/api/v1/environments", () => ({ status: 200, body: { machine: { id: "m-devbox", name: "devbox" }, identities, found } }))
        .on("GET", "/api/v1/envs/test-new", { status: 200, body: made }),
    );
    const list = await screen.findByRole("list", { name: "Environments" });
    await within(list).findByRole("link", { name: /test-work/ });
    identities = [...identities, made];
    window.location.hash = "#/envs/this/test-new";
    expect(await within(list).findByRole("link", { name: /test-new/ })).toHaveAttribute("aria-current", "page");
  });

  it("shows why a delete is refused while mates use the environment", async () => {
    const user = userEvent.setup();
    open("#/envs/this/test-work", true, (s) =>
      s.on("DELETE", "/api/v1/envs/test-work", { status: 500, body: { error: { code: "failed", message: "environment test-work is used by mate rex, milo" } } }),
    );
    await user.click(await screen.findByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete…" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("environment test-work is used by mate rex, milo");
  });

  it("saves the git identity when both fields are filled", async () => {
    const user = userEvent.setup();
    const { server } = open("#/envs/this/test-work", true, (s) => s.on("POST", "/api/v1/envs/test-work", { status: 200, body: work }));
    await user.type(await screen.findByLabelText("Name"), "TEST bot");
    await user.type(screen.getByLabelText("Email"), "bot@example.com");
    await user.tab();
    await waitFor(() => expect(server.calls.some((c) => c.method === "POST" && c.path === "/api/v1/envs/test-work")).toBe(true));
    expect(server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/envs/test-work")?.body).toEqual({ git_name: "TEST bot", git_email: "bot@example.com" });
  });

  it("on the phone shows the list first and is on the More page", async () => {
    open("#/more", false);
    expect(screen.getByRole("link", { name: /Environments/ })).toHaveAttribute("href", "#/envs");
  });

  it("warns on the local row when another tool removed the crew hooks, and fixes them", async () => {
    const user = userEvent.setup();
    const missing = [{ env: "local", harness: "claude", file: "/home/me/.claude/settings.json", reason: "crew hooks are missing in ~/.claude/settings.json" }];
    let fixed = false;
    const { server } = open("#/envs/this/local", true, (s) =>
      s
        .on("GET", "/api/v1/envs/local", () => ({ status: 200, body: fixed ? local : { ...local, hooks_missing: missing } }))
        .on("POST", "/api/v1/hooks/fix", () => ((fixed = true), { status: 200, body: { missing: [] } })),
    );
    const alert = await screen.findByRole("alert", { name: "Claude hooks" });
    expect(alert).toHaveTextContent("crew hooks are missing in ~/.claude/settings.json");
    await user.click(within(alert).getByRole("button", { name: "Fix" }));
    await waitFor(() => expect(screen.queryByRole("alert", { name: "Claude hooks" })).not.toBeInTheDocument());
    expect(server.calls.find((c) => c.path === "/api/v1/hooks/fix")?.body).toEqual({ env: "local", harness: "claude" });
  });
});

function machineRoutes(id: string, name: string, identities: EnvInfo[], mates: string[]) {
  return (path: string) => {
    const body =
      path === "/api/v1/environments"
        ? { machine: { id, name }, identities, found }
        : path === "/api/v1/mates"
          ? { mates: mates.map((m) => ({ name: m })) }
          : path === "/api/v1/hello"
            ? { api: "v1", build: "v0.42.1" }
            : path.startsWith("/api/v1/envs/")
              ? identities.find((e) => path === "/api/v1/envs/" + e.name)
              : [];
    return { status: 200, body: JSON.stringify(body ?? {}) };
  };
}

function twoMachines(hash: string, wide = true) {
  const app = new FakeDesktop();
  app.servers = [
    { id: "local", name: "This computer", kind: "local", detail: "crew on this computer" },
    { id: "ssh:giovani@devbox", name: "devbox", kind: "ssh", detail: "over SSH" },
    { id: "ssh:ci", name: "ci-runner", kind: "ssh", detail: "over SSH" },
  ];
  const mac = machineRoutes("m-mac", "mac", [{ ...local, used_by: ["ada"] }], ["ada"]);
  const box = machineRoutes("m-box", "devbox", [{ ...local, used_by: ["rex"] }, { ...work, name: "work-bot", used_by: ["milo"] }], ["rex"]);
  app.handlers.crew_machine_request = (args) => {
    if (args?.machineId === "ssh:ci") {
      throw "machine not reachable";
    }
    return (args?.machineId === "local" ? mac : box)(String(args?.path));
  };
  const d = desktop(hash, wide, undefined, { desktop: app }, routes);
  d.live();
  return { ...d, app };
}

describe("environments on several machines", () => {
  it("lists each machine with its identities, This Mac first, and a machine that does not answer", async () => {
    twoMachines("#/envs");
    const list = await screen.findByRole("list", { name: "Environments" });
    await waitFor(() => expect(within(list).getAllByRole("link").length).toBe(7));
    expect(within(list).getAllByRole("link").map((r) => r.textContent)).toEqual([
      expect.stringContaining("This Maccrew runs here"),
      expect.stringContaining("Your accountsada"),
      expect.stringContaining("devboxSSH · giovani@devbox"),
      expect.stringContaining("Your accountsrex"),
      expect.stringContaining("work-botSeparate identity · milo"),
      expect.stringContaining("ci-runnerSSH · not reachable"),
      expect.stringContaining("Your accountsnot used"),
    ]);
    expect(screen.getByRole("button", { name: "+ Machine" })).toBeInTheDocument();
  });

  it("opens an identity of a different machine through that machine (11b)", async () => {
    const { app } = twoMachines("#/envs/" + encodeURIComponent("ssh:giovani@devbox") + "/work-bot");
    expect(await screen.findByRole("heading", { name: "work-bot" })).toBeInTheDocument();
    expect(screen.getByLabelText("Breadcrumb")).toHaveTextContent("devbox›work-bot");
    expect(app.of("crew_machine_request")).toContainEqual(expect.objectContaining({ machineId: "ssh:giovani@devbox", path: "/api/v1/envs/work-bot" }));
  });

  it("shows the SSH address of a server", async () => {
    twoMachines("#/envs/" + encodeURIComponent("ssh:giovani@devbox"));
    expect(await screen.findByRole("group", { name: "Address" })).toHaveTextContent("giovani@devbox");
    expect(screen.getByText("A server that you connected over SSH. Its own crew runs there, so mates on devbox keep working when this Mac sleeps.")).toBeInTheDocument();
  });

  it("shows machine not reachable for a machine that does not answer", async () => {
    twoMachines("#/envs/" + encodeURIComponent("ssh:ci"));
    expect(await screen.findByRole("heading", { name: "ci-runner" })).toBeInTheDocument();
    expect(screen.getAllByText("machine not reachable").length).toBeGreaterThan(0);
  });
});
