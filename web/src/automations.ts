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
  kept: Pick<Automation, "browser" | "filter">;
};

export function newDraft(): AutomationDraft {
  return { name: "", agent: "claude", model: "", effort: "", target: "new-worktree", prompt: "", schedule: "", timezone: "", on: "", precheck: "", session: "fresh", enabled: true, kept: {} };
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
    kept: { browser: a.browser, filter: a.filter },
  };
}

export type SavedAutomation = Omit<Automation, "source">;

export function automationOf(d: AutomationDraft): SavedAutomation {
  const out: Record<string, unknown> = { name: d.name.trim(), agent: d.agent };
  if (d.kept.browser) {
    out.browser = d.kept.browser;
  }
  if (d.kept.filter) {
    out.filter = d.kept.filter;
  }
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

export function sinceLabel(start: string | undefined, now: number): string {
  const at = start ? Date.parse(start) : NaN;
  if (Number.isNaN(at)) {
    return "";
  }
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return minutes + "m ago";
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return hours + "h ago";
  }
  return hours < 48 ? "yesterday" : Math.floor(hours / 24) + "d ago";
}

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function runLabel(start: string | undefined, now: number): string {
  const at = start ? new Date(start) : null;
  if (!at || Number.isNaN(at.getTime())) {
    return "";
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const clock = pad(at.getHours()) + ":" + pad(at.getMinutes());
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(new Date(now)) - day(at)) / 86400000);
  if (days === 0) {
    return "Today " + clock;
  }
  if (days === 1) {
    return "Yesterday " + clock;
  }
  if (days > 1 && days < 7) {
    return weekdays[at.getDay()] + " " + clock;
  }
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${clock}`;
}

export function runDuration(start: string | undefined, end: string | undefined): string {
  const a = start ? Date.parse(start) : NaN;
  const b = end ? Date.parse(end) : NaN;
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) {
    return "";
  }
  const s = Math.round((b - a) / 1000);
  if (s < 60) {
    return s + "s";
  }
  if (s < 3600) {
    return Math.floor(s / 60) + "m " + (s % 60) + "s";
  }
  return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
}
