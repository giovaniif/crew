import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { Automation, AutomationRun } from "../api";
import { automationOf, automationRows, draftOf, newDraft, type AutomationQuery } from "../automations";
import { desktop } from "../test/desktop";

afterEach(() => {
  window.location.hash = "";
});

const list: Automation[] = [
  { name: "fix-ci", agent: "claude", target: "new-worktree", prompt: "Fix the CI of {{work_item}}.", on: ["pr.ci_failed"], enabled: true, source: "/h/config.toml" },
  { name: "deps", agent: "codex", prompt: "Update the deps.", schedule: "weekly mon 09:00", enabled: false, source: "/h/config.toml" },
  { name: "audit", agent: "claude", prompt: "Audit the api for leaked secrets.", enabled: true, source: "/src/api/.crew.toml" },
];

const runs: AutomationRun[] = [
  { id: "r3", automation: "deps", trigger: "schedule", outcome: "succeeded", start: "2026-10-03T11:30:00Z" },
  { id: "r2", automation: "fix-ci", trigger: "pr.ci_failed", outcome: "failed", reason: "agent exited", start: "2026-10-03T11:00:00Z" },
  { id: "r1", automation: "fix-ci", trigger: "manual", outcome: "succeeded", session_id: "s1", start: "2026-10-02T09:00:00Z" },
];

const all: AutomationQuery = { search: "", enabled: null, outcome: null, agent: null, sort: "name" };
const names = (q: Partial<typeof all>) => automationRows(list, runs, { ...all, ...q }).map((r) => r.automation.name);

describe("the automation rows", () => {
  it("sorts by name or by the newest last run", () => {
    expect(names({})).toEqual(["audit", "deps", "fix-ci"]);
    expect(names({ sort: "lastRun" })).toEqual(["deps", "fix-ci", "audit"]);
  });

  it("searches the name and the prompt", () => {
    expect(names({ search: "SECRETS" })).toEqual(["audit"]);
    expect(names({ search: "fix" })).toEqual(["fix-ci"]);
  });

  it("filters by state, last outcome and agent", () => {
    expect(names({ enabled: false })).toEqual(["deps"]);
    expect(names({ outcome: "failed" })).toEqual(["fix-ci"]);
    expect(names({ outcome: "never" })).toEqual(["audit"]);
    expect(names({ agent: "codex" })).toEqual(["deps"]);
  });

  it("turns a draft back into the automation it came from", () => {
    expect(automationOf(draftOf(list[0]))).toEqual({ name: "fix-ci", agent: "claude", target: "new-worktree", prompt: "Fix the CI of {{work_item}}.", on: ["pr.ci_failed"], enabled: true, session: "fresh" });
  });

  it("keeps the mate of an automation and starts a new one for a mate", () => {
    const a: Automation = { name: "test-weekly", agent: "claude", mate: "test-ada", prompt: "TEST", enabled: true, source: "/h/config.toml" };
    expect(automationOf(draftOf(a))).toMatchObject({ mate: "test-ada" });
    expect(automationOf({ ...newDraft("test-ada"), name: "test-new", prompt: "TEST" })).toMatchObject({ mate: "test-ada" });
    expect(automationOf({ ...newDraft(), name: "test-new", prompt: "TEST" })).not.toHaveProperty("mate");
  });

  it("keeps the fields that the form does not show", () => {
    const a: Automation = { name: "review", agent: "claude", prompt: "Review it.", browser: "headless", filter: { branch: "feat/*" }, enabled: true, source: "/h/config.toml" };
    const d = { ...draftOf(a), prompt: "Review it again." };
    expect(automationOf(d)).toMatchObject({ prompt: "Review it again.", browser: "headless", filter: { branch: "feat/*" } });
  });
});

async function open() {
  const view = desktop();
  view.server
    .on("GET", "/api/v1/automations", { status: 200, body: { automations: list } })
    .on("GET", "/api/v1/automations/runs?limit=100", { status: 200, body: { runs } })
    .on("POST", "/api/v1/automations", (call) => ({ status: 200, body: { ...(call.body as { automation: Automation }).automation, source: "/h/config.toml" } }))
    .on("POST", "/api/v1/automations/runs/r2/rerun", { status: 200, body: { run: { id: "r4", automation: "fix-ci", outcome: "succeeded", session_id: "s4" }, session: { ID: "s4" } } });
  view.live();
  await userEvent.click(within(screen.getByRole("navigation", { name: "Sidebar" })).getByRole("link", { name: "Automations" }));
  return view;
}

describe("the Automations window", () => {
  it("opens from the sidebar and filters the list", async () => {
    await open();
    await screen.findByRole("row", { name: "fix-ci" });
    await userEvent.type(screen.getByRole("searchbox", { name: "Search automations" }), "deps");
    expect(screen.queryByRole("row", { name: "fix-ci" })).not.toBeInTheDocument();
    expect(screen.getByRole("row", { name: "deps" })).toBeInTheDocument();
  });

  it("shows the details and the history, and reruns a run", async () => {
    await open();
    await userEvent.click(await screen.findByRole("row", { name: "fix-ci" }));
    const panel = screen.getByRole("complementary", { name: "fix-ci" });
    expect(within(panel).getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    expect(panel).toHaveTextContent("Fix the CI of {{work_item}}.");
    await userEvent.click(within(panel).getByRole("tab", { name: "History" }));
    const rows = within(within(panel).getByRole("list", { name: "Run history of fix-ci" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByRole("link", { name: "Open session" })).toHaveAttribute("href", "#/sessions/s1");
    await userEvent.click(within(rows[0]).getByRole("button", { name: "Rerun" }));
    await waitFor(() => expect(window.location.hash).toBe("#/sessions/s4"));
  });

  it("edits an automation in the side panel through automation.save", async () => {
    const { server } = await open();
    await userEvent.click(await screen.findByRole("row", { name: "deps" }));
    const panel = screen.getByRole("complementary", { name: "deps" });
    await userEvent.click(within(panel).getByRole("button", { name: "Edit" }));
    const form = within(panel).getByRole("form", { name: "Edit deps" });
    expect(within(form).getByRole("textbox", { name: "Schedule" })).toHaveClass("ui", "input");
    await userEvent.click(within(form).getByRole("checkbox", { name: "Enabled" }));
    await userEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/automations")?.body).toEqual({
        automation: { name: "deps", agent: "codex", prompt: "Update the deps.", schedule: "weekly mon 09:00", enabled: true, session: "fresh" },
      }),
    );
  });

  it("makes a new automation in the side panel", async () => {
    const { server } = await open();
    await screen.findByRole("row", { name: "fix-ci" });
    await userEvent.click(screen.getByRole("button", { name: "New automation" }));
    const form = within(screen.getByRole("complementary", { name: "New automation" })).getByRole("form", { name: "New automation" });
    await userEvent.type(within(form).getByRole("textbox", { name: "Name" }), "triage");
    await userEvent.type(within(form).getByRole("textbox", { name: "Prompt" }), "Triage the new issues.");
    await userEvent.type(within(form).getByRole("textbox", { name: "Schedule" }), "daily 08:00");
    await userEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/automations")?.body).toEqual({
        automation: { name: "triage", agent: "claude", target: "new-worktree", prompt: "Triage the new issues.", schedule: "daily 08:00", enabled: true, session: "fresh" },
      }),
    );
  });

  it("shows the .crew.toml of a repo automation, with no Edit and a switch that cannot change", async () => {
    await open();
    const audit = await screen.findByRole("row", { name: "audit" });
    expect(within(audit).getByRole("switch", { name: "Enable audit" })).toBeDisabled();
    await userEvent.click(audit);
    const panel = screen.getByRole("complementary", { name: "audit" });
    expect(panel).toHaveTextContent("/src/api/.crew.toml");
    expect(within(panel).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });
});
