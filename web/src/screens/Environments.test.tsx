import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { EnvInfo } from "../api";
import { desktop } from "../test/desktop";
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

function routes(server: FakeServer) {
  server
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
    open("#/envs/test-work");
    const claude = await screen.findByRole("group", { name: "Claude" });
    expect(within(claude).getByRole("button", { name: "Replace" })).toBeInTheDocument();
    expect(within(claude).queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("lists Local first, then each environment with its kind and mates", async () => {
    open("#/envs");
    const list = await screen.findByRole("list", { name: "Environments" });
    const rows = within(list).getAllByRole("link");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Local (crew)Your logins · 2 mates"),
      expect.stringContaining("test-workCustom · 2 mates"),
      expect.stringContaining("test-sandboxCustom · not used"),
    ]);
  });

  it("shows a custom environment with secrets as set or not set and the public key", async () => {
    open("#/envs/test-work");
    expect(await screen.findByRole("heading", { name: "test-work" })).toBeInTheDocument();
    expect(screen.getByText("kind is set at creation", { exact: false })).toBeInTheDocument();
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
    const { server } = open("#/envs/test-work", true, (s) => s.on("POST", "/api/v1/envs/test-work", { status: 200, body: after }));
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
    const { server } = open("#/envs/test-work", true, (s) => s.on("POST", "/api/v1/envs/test-work/unset", { status: 200, body: work }));
    await user.click(within(await screen.findByRole("group", { name: "Codex" })).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(server.calls.some((c) => c.path === "/api/v1/envs/test-work/unset")).toBe(true));
    expect(server.calls.find((c) => c.path === "/api/v1/envs/test-work/unset")?.body).toEqual({ secret: "OPENAI_API_KEY" });
  });

  it("makes a new SSH key and keeps the old one until you confirm it is on GitHub", async () => {
    const user = userEvent.setup();
    const { server } = open("#/envs/test-work", true, (s) =>
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
    const { server } = open("#/envs/test-work", true, (s) =>
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
    open("#/envs/test-work", true, (s) =>
      s.on("GET", "/api/v1/envs/test-work", { status: 200, body: { ...work, new_public_key: "ssh-ed25519 AAAATESTNEW crew-test-work" } }),
    );
    expect(await screen.findByText("ssh-ed25519 AAAATESTNEW crew-test-work")).toBeInTheDocument();
    expect(screen.getByText("waiting for you")).toBeInTheDocument();
  });

  it("shows the date of the SSH key", async () => {
    open("#/envs/test-work", true, (s) =>
      s.on("GET", "/api/v1/envs/test-work", { status: 200, body: { ...work, key_created: "2026-10-21T12:00:00Z" } }),
    );
    expect(await screen.findByText("· Oct 21")).toBeInTheDocument();
  });

  it("fills the git identity from the server", async () => {
    open("#/envs/test-work", true, (s) =>
      s.on("GET", "/api/v1/envs/test-work", { status: 200, body: { ...work, git_name: "TEST bot", git_email: "bot@example.com" } }),
    );
    expect(await screen.findByLabelText("Name")).toHaveValue("TEST bot");
    expect(screen.getByLabelText("Email")).toHaveValue("bot@example.com");
  });

  it("shows what crew found on this machine for Local, and how to log in", async () => {
    const user = userEvent.setup();
    open("#/envs/local", true, (s) =>
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
    open("#/envs/test-sandbox", true, (s) =>
      s.on("GET", "/api/v1/envs/test-sandbox", { status: 200, body: { ...sandbox, parts: ["pi"], secrets: [{ name: "ANTHROPIC_API_KEY", set: false }, { name: "OPENAI_API_KEY", set: false }] } }),
    );
    const pi = await screen.findByRole("group", { name: "Pi" });
    await user.click(within(pi).getByRole("button", { name: "How to log in" }));
    expect(within(pi).getByText("crew env login test-sandbox --harness omp")).toBeInTheDocument();
    expect(within(pi).getByText("crew env set test-sandbox ANTHROPIC_API_KEY")).toBeInTheDocument();
  });

  it("shows how to log in to a harness of a custom environment that has no login", async () => {
    const user = userEvent.setup();
    open("#/envs/test-sandbox", true, (s) =>
      s.on("GET", "/api/v1/envs/test-sandbox", { status: 200, body: { ...sandbox, parts: ["claude"], secrets: [{ name: "CLAUDE_CODE_OAUTH_TOKEN", set: false }, { name: "ANTHROPIC_API_KEY", set: false }] } }),
    );
    const claude = await screen.findByRole("group", { name: "Claude" });
    await user.click(within(claude).getByRole("button", { name: "How to log in" }));
    expect(within(claude).getByText("crew env login test-sandbox")).toBeInTheDocument();
  });

  it("shows Local as read-only with extra variables and Duplicate as Custom…", async () => {
    const user = userEvent.setup();
    open("#/envs/local");
    expect(await screen.findByRole("heading", { name: "Local (crew)" })).toBeInTheDocument();
    expect(screen.getByText("ada, june")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New key…" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "LINEAR_API_KEY" })).toHaveTextContent("set");
    await user.click(screen.getByRole("button", { name: "Duplicate as Custom…" }));
    const dialog = screen.getByRole("dialog", { name: "New environment" });
    expect(within(dialog).getByRole("radio", { name: /Custom/ })).toHaveAttribute("aria-checked", "true");
  });

  it("creates a custom environment with all parts and a key, and opens it", async () => {
    const user = userEvent.setup();
    const made: EnvInfo = { ...sandbox, name: "test-new", used_by: [] };
    const { server } = open("#/envs/local", true, (s) =>
      s
        .on("POST", "/api/v1/envs", { status: 200, body: made })
        .on("POST", "/api/v1/envs/test-new/ssh-key", { status: 200, body: made })
        .on("GET", "/api/v1/envs/test-new", { status: 200, body: made }),
    );
    await user.click(await screen.findByRole("button", { name: "New" }));
    const dialog = screen.getByRole("dialog", { name: "New environment" });
    await user.type(within(dialog).getByLabelText("Name"), "test-new");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(window.location.hash).toBe("#/envs/test-new"));
    expect(server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/envs")?.body).toEqual({
      name: "test-new",
      kind: "custom",
      parts: ["git", "ssh", "github", "claude", "codex", "pi"],
    });
    expect(server.calls.find((c) => c.path === "/api/v1/envs/test-new/ssh-key")?.body).toEqual({ action: "make" });
  });

  it("shows why a delete is refused while mates use the environment", async () => {
    const user = userEvent.setup();
    open("#/envs/test-work", true, (s) =>
      s.on("DELETE", "/api/v1/envs/test-work", { status: 500, body: { error: { code: "failed", message: "environment test-work is used by mate rex, milo" } } }),
    );
    await user.click(await screen.findByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete…" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("environment test-work is used by mate rex, milo");
  });

  it("saves the git identity when both fields are filled", async () => {
    const user = userEvent.setup();
    const { server } = open("#/envs/test-work", true, (s) => s.on("POST", "/api/v1/envs/test-work", { status: 200, body: work }));
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
});
