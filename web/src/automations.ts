import type { Automation, AutomationRun } from "./api";

export type AutomationSort = "name" | "lastRun";

export type AutomationQuery = {
  search: string;
  enabled: boolean | null;
  outcome: string | null;
  agent: string | null;
  sort: AutomationSort;
};

export type AutomationRow = { automation: Automation; last: AutomationRun | null };

function started(run: AutomationRun | null | undefined): number {
  const t = run?.start ? Date.parse(run.start) : NaN;
  return Number.isNaN(t) ? -Infinity : t;
}

export function runsOf(name: string, runs: AutomationRun[]): AutomationRun[] {
  return runs.filter((r) => r.automation === name).sort((a, b) => started(b) - started(a));
}

export function automationRows(list: Automation[], runs: AutomationRun[], q: AutomationQuery): AutomationRow[] {
  const needle = q.search.trim().toLowerCase();
  const rows = list
    .map((automation) => ({ automation, last: runsOf(automation.name, runs)[0] ?? null }))
    .filter(({ automation: a, last }) => {
      if (needle && !a.name.toLowerCase().includes(needle) && !a.prompt.toLowerCase().includes(needle)) {
        return false;
      }
      if (q.enabled !== null && a.enabled !== q.enabled) {
        return false;
      }
      if (q.outcome !== null && (last?.outcome ?? "never") !== q.outcome) {
        return false;
      }
      return q.agent === null || a.agent === q.agent;
    });
  const byName = (x: AutomationRow, y: AutomationRow) => (x.automation.name < y.automation.name ? -1 : x.automation.name > y.automation.name ? 1 : 0);
  if (q.sort === "lastRun") {
    return rows.sort((x, y) => started(y.last) - started(x.last) || byName(x, y));
  }
  return rows.sort(byName);
}

export function repoSource(a: Automation): string | null {
  return a.source.endsWith("/.crew.toml") ? a.source : null;
}

export type AutomationDraft = {
  name: string;
  agent: string;
  model: string;
  effort: string;
  target: string;
  prompt: string;
  schedule: string;
  timezone: string;
  on: string;
  precheck: string;
  session: string;
  enabled: boolean;
};

export function newDraft(): AutomationDraft {
  return { name: "", agent: "claude", model: "", effort: "", target: "new-worktree", prompt: "", schedule: "", timezone: "", on: "", precheck: "", session: "fresh", enabled: true };
}

export function draftOf(a: Automation): AutomationDraft {
  return {
    name: a.name,
    agent: a.agent,
    model: a.model ?? "",
    effort: a.effort ?? "",
    target: a.target ?? "",
    prompt: a.prompt,
    schedule: a.schedule ?? "",
    timezone: a.timezone ?? "",
    on: (a.on ?? []).join(", "),
    precheck: a.precheck ?? "",
    session: a.session ?? "fresh",
    enabled: a.enabled,
  };
}

export type SavedAutomation = Omit<Automation, "source">;

export function automationOf(d: AutomationDraft): SavedAutomation {
  const out: Record<string, unknown> = { name: d.name.trim(), agent: d.agent };
  const set = (key: string, value: string) => {
    if (value.trim()) {
      out[key] = value.trim();
    }
  };
  set("model", d.model);
  set("effort", d.effort);
  set("target", d.target);
  out.prompt = d.prompt;
  set("schedule", d.schedule);
  set("timezone", d.timezone);
  const events = d.on
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  if (events.length > 0) {
    out.on = events;
  }
  set("precheck", d.precheck);
  out.enabled = d.enabled;
  set("session", d.session);
  return out as SavedAutomation;
}
