import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App, type AppEnv } from "../App";
import { FakeServer, MemoryStorage } from "../test/fake-server";
import { FakeSockets } from "../test/fake-socket";

const device = { id: "k3m9p2qx", name: "work phone", created_at: "2026-10-03T10:00:00Z", last_seen: "2026-10-03T10:00:00Z" };

const automations = {
  automations: [
    { name: "fix-ci", agent: "claude", target: "new-worktree", prompt: "Fix the CI of {{work_item}}.", on: ["pr.ci_failed"], enabled: true, source: "/h/config.toml" },
    { name: "deps", agent: "codex", prompt: "Update the deps.", schedule: "weekly mon 09:00", timezone: "America/Sao_Paulo", precheck: "gh pr list", enabled: false, source: "/h/config.toml" },
  ],
};

const runs = {
  runs: [
    { id: "r2", automation: "fix-ci", trigger: "pr.ci_failed", outcome: "failed", reason: "agent exited", start: "2026-10-03T11:00:00Z", end: "2026-10-03T11:05:00Z" },
    { id: "r1", automation: "fix-ci", trigger: "manual", outcome: "succeeded", session_id: "s1", start: "2026-10-02T09:00:00Z", end: "2026-10-02T09:30:12Z" },
  ],
};

function setup(hash: string) {
  const server = new FakeServer()
    .on("GET", "/api/v1/hello", { status: 200, body: { api: "v1", build: "v0.12.0+abc" } })
    .on("GET", "/api/v1/automations", { status: 200, body: automations })
    .on("GET", "/api/v1/automations/runs?limit=100", { status: 200, body: runs });
  const storage = new MemoryStorage();
  storage.setItem("crew.auth", JSON.stringify({ token: "t0k", device }));
  const env: AppEnv = {
    fetch: server.fetch,
    storage,
    installed: true,
    hash,
    host: "crew.example.ts.net",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    openStream: new FakeSockets().open,
    now: () => Date.parse("2026-10-03T12:00:00Z"),
    onHashChange: () => () => undefined,
  };
  return { server, env };
}

const row = (name: string) => screen.findByRole("row", { name });

async function select(name: string) {
  await userEvent.click(await row(name));
  return screen.getByRole("complementary", { name });
}

describe("Automations", () => {
  it("is a tab next to the session list", () => {
    const { env } = setup("");
    render(<App env={env} />);
    expect(screen.getByRole("link", { name: "Automations" })).toHaveAttribute("href", "#/automations");
  });

  it("shows the config problems that the server reports", async () => {
    const { server, env } = setup("#/automations");
    server.on("GET", "/api/v1/automations", { status: 200, body: { ...automations, problems: ['/h/config.toml: automation "bad": agent must be one of [claude codex omp]'] } });
    render(<App env={env} />);
    expect(await screen.findByText('/h/config.toml: automation "bad": agent must be one of [claude codex omp]')).toBeInTheDocument();
  });

  it("says Loading… until the list comes, then counts the automations", async () => {
    const { env } = setup("#/automations");
    render(<App env={env} />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(await screen.findByLabelText("2 automations")).toHaveTextContent("2");
  });

  it("tells how to add one when there are none", async () => {
    const { server, env } = setup("#/automations");
    server.on("GET", "/api/v1/automations", { status: 200, body: { automations: [] } });
    render(<App env={env} />);
    expect(await screen.findByText("No automations. Add [[automation]] tables to config.toml on the server.")).toBeInTheDocument();
  });

  it("puts each automation in a table row with its trigger, agent, last run and switch", async () => {
    const { env } = setup("#/automations");
    render(<App env={env} />);
    const fix = await row("fix-ci");
    expect(within(fix).getByText("on pr.ci_failed")).toHaveClass("mono");
    expect(fix).toHaveTextContent("claude");
    expect(await within(fix).findByText("failed")).toHaveClass("pill", "bad");
    expect(fix).toHaveTextContent("1h ago");
    expect(within(fix).getByRole("switch", { name: "Enable fix-ci" })).toHaveAttribute("aria-checked", "true");
    const deps = await row("deps");
    expect(deps).toHaveTextContent("weekly mon 09:00");
    expect(deps).toHaveTextContent("Never run");
    expect(within(deps).getByRole("switch", { name: "Enable deps" })).toHaveAttribute("aria-checked", "false");
  });

  it("turns an automation on with the switch through automation.save", async () => {
    const { server, env } = setup("#/automations");
    server.on("POST", "/api/v1/automations", (call) => ({ status: 200, body: { ...(call.body as { automation: object }).automation, source: "/h/config.toml" } }));
    render(<App env={env} />);
    await userEvent.click(within(await row("deps")).getByRole("switch", { name: "Enable deps" }));
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === "POST")?.body).toEqual({
        automation: { name: "deps", agent: "codex", prompt: "Update the deps.", schedule: "weekly mon 09:00", timezone: "America/Sao_Paulo", precheck: "gh pr list", enabled: true, session: "fresh" },
      }),
    );
  });

  it("tells an old server to update when the switch cannot save", async () => {
    const { server, env } = setup("#/automations");
    server.on("POST", "/api/v1/automations", { status: 404, body: { error: { code: "unknown_method", message: "unknown method" } } });
    render(<App env={env} />);
    await userEvent.click(within(await row("deps")).getByRole("switch", { name: "Enable deps" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This server cannot do this. Update crew on the server.");
  });

  it("filters with the chips and the search, and says when nothing matches", async () => {
    const { env } = setup("#/automations");
    render(<App env={env} />);
    await row("fix-ci");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "State: All" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Paused" }));
    expect(screen.queryByRole("row", { name: "fix-ci" })).not.toBeInTheDocument();
    expect(screen.getByRole("row", { name: "deps" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "State: Paused" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "All" }));
    await user.click(screen.getByRole("button", { name: "Last run: Any" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Failed" }));
    expect(screen.getAllByRole("row").map((r) => r.getAttribute("aria-label")).filter(Boolean)).toEqual(["fix-ci"]);
    await user.click(screen.getByRole("button", { name: "Last run: Failed" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Any" }));
    await user.click(screen.getByRole("button", { name: "Agent: All" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "codex" }));
    expect(screen.getAllByRole("row").map((r) => r.getAttribute("aria-label")).filter(Boolean)).toEqual(["deps"]);
    await user.type(screen.getByRole("searchbox", { name: "Search automations" }), "nothing like this");
    expect(screen.getByText("No automation matches.")).toBeInTheDocument();
  });

  it("sorts by the last run from its column head", async () => {
    const { server, env } = setup("#/automations");
    server.on("GET", "/api/v1/automations/runs?limit=100", { status: 200, body: { runs: [{ id: "r9", automation: "deps", outcome: "succeeded", start: "2026-10-03T11:30:00Z" }, ...runs.runs] } });
    render(<App env={env} />);
    await row("fix-ci");
    const order = () => screen.getAllByRole("row").map((r) => r.getAttribute("aria-label")).filter(Boolean);
    expect(order()).toEqual(["deps", "fix-ci"]);
    await userEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(screen.getByRole("button", { name: "Last run" }));
    expect(screen.getByRole("columnheader", { name: "Last run" })).toHaveAttribute("aria-sort", "descending");
    expect(order()).toEqual(["deps", "fix-ci"]);
  });

  it("opens a side panel with the details and the recent runs of the selected row", async () => {
    const tz = process.env.TZ;
    process.env.TZ = "America/Sao_Paulo";
    try {
      const { env } = setup("#/automations");
      render(<App env={env} />);
      const panel = await select("fix-ci");
      expect(screen.getByRole("row", { name: "fix-ci" })).toHaveAttribute("aria-selected", "true");
      expect(within(panel).getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
      const facts = within(panel).getByRole("definition", { name: "Trigger" });
      expect(facts).toHaveTextContent("on pr.ci_failed");
      expect(within(panel).getByRole("definition", { name: "Agent" })).toHaveTextContent("claude");
      expect(within(panel).getByRole("definition", { name: "Target" })).toHaveTextContent("new-worktree");
      expect(within(panel).getByRole("definition", { name: "Session" })).toHaveTextContent("new each run");
      expect(panel).toHaveTextContent("Fix the CI of {{work_item}}.");
      const recent = within(panel).getByRole("list", { name: "Recent runs of fix-ci" });
      const items = within(recent).getAllByRole("listitem");
      expect(items[0]).toHaveTextContent("Today 08:00");
      expect(items[0]).toHaveTextContent("agent exited");
      expect(items[1]).toHaveTextContent("Yesterday 06:00");
      expect(items[1]).toHaveTextContent("30m 12s");
      expect(within(items[1]).getByRole("link", { name: "Open" })).toHaveAttribute("href", "#/sessions/s1");
    } finally {
      process.env.TZ = tz;
    }
  });

  it("refuses a new automation with the name of one that exists, so Save cannot replace it", async () => {
    const { env } = setup("#/automations");
    render(<App env={env} />);
    await row("fix-ci");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "New automation" }));
    const form = screen.getByRole("form", { name: "New automation" });
    await user.type(within(form).getByLabelText("Name"), "fix-ci");
    await user.type(within(form).getByLabelText("Prompt"), "TEST prompt");
    expect(within(form).getByText("An automation named fix-ci exists.")).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("runs an automation with context from Run now and opens its session", async () => {
    const { server, env } = setup("#/automations");
    server.on("POST", "/api/v1/automations/fix-ci/run", {
      status: 200,
      body: { run: { id: "r1", automation: "fix-ci", outcome: "succeeded", session_id: "s9" }, session: { ID: "s9" } },
    });
    render(<App env={env} />);
    const panel = await select("fix-ci");
    await userEvent.click(within(panel).getByRole("button", { name: "Run now" }));
    await userEvent.type(within(panel).getByRole("textbox", { name: "Context" }), "only the lint job");
    await userEvent.type(within(panel).getByRole("textbox", { name: "Work item" }), "#42");
    await userEvent.click(within(panel).getByRole("button", { name: "Run" }));
    const post = server.calls.find((c) => c.method === "POST");
    expect(post?.body).toEqual({ context: "only the lint job", work_item: "#42" });
    expect(window.location.hash).toBe("#/sessions/s9");
  });

  it("shows a skipped run in the panel and in the last run of its row", async () => {
    const { server, env } = setup("#/automations");
    server.on("POST", "/api/v1/automations/deps/run", {
      status: 200,
      body: { run: { id: "r3", automation: "deps", trigger: "manual", outcome: "skipped", reason: "precheck failed", start: "2026-10-03T11:58:00Z" }, session: { ID: "" } },
    });
    render(<App env={env} />);
    const panel = await select("deps");
    await userEvent.click(within(panel).getByRole("button", { name: "Run now" }));
    await userEvent.click(within(panel).getByRole("button", { name: "Run" }));
    expect(await within(panel).findByRole("status")).toHaveTextContent("skipped: precheck failed");
    expect(within(screen.getByRole("row", { name: "deps" })).getByText("skipped")).toHaveClass("pill");
  });
});
