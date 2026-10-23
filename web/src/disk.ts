import type { PullRequest, Session, Worktree } from "./stream";

export type CleanupAction = "remove" | "backup_then_ask" | "keep";

export type DiskRow = { WorktreeID: string; Size: number; Action: CleanupAction; Reason: string };

export type DiskPort = { port: number; pgid: number; command: string; worktree: string; session: string };

export type RecentCleanup = { at: string; path: string; branch?: string; action: CleanupAction; outcome: string };

export type DiskView = {
  free: number;
  total: number;
  auto_clean_every: number;
  next_cleanup?: string;
  deps_store?: { path: string; size: number };
  rows: DiskRow[];
  recent: RecentCleanup[];
  reclaimable: number;
  reclaimable_pending: number;
  worktrees_size: number;
  worktrees_pending: number;
  ports: DiskPort[];
};

export type CleanupItem = { path: string; branch?: string; action: CleanupAction; reason: string; outcome?: string };

const units = ["B", "KB", "MB", "GB", "TB"];

export function sizeLabel(bytes: number): string {
  if (bytes < 0) {
    return "…";
  }
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  if (unit === 0 || value >= 10) {
    return Math.round(value) + " " + units[unit];
  }
  return Math.round(value * 10) / 10 + " " + units[unit];
}

function measured(bytes: number, pending: number): string {
  if (pending === 0) {
    return sizeLabel(bytes);
  }
  return bytes === 0 ? "…" : sizeLabel(bytes) + "+";
}

function every(seconds: number): string {
  if (seconds % 3600 === 0) {
    return seconds / 3600 + "h";
  }
  if (seconds % 60 === 0) {
    return seconds / 60 + "m";
  }
  return seconds + "s";
}

export type DiskTiles = { free: string; worktrees: string; reclaimable: string; depsStore: string | null; schedule: string };

export function diskTiles(v: DiskView): DiskTiles {
  const seconds = Math.floor(v.auto_clean_every / 1e9);
  return {
    free: sizeLabel(v.free) + " free",
    worktrees: measured(v.worktrees_size, v.worktrees_pending),
    reclaimable: measured(v.reclaimable, v.reclaimable_pending),
    depsStore: v.deps_store ? sizeLabel(v.deps_store.size) : null,
    schedule: seconds > 0 ? "every " + every(seconds) : "off",
  };
}

export type DiskCard = { title: string; value: string; sub: string; usage: number | null };

function storeName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  return last === "store" && parts.length > 1 ? parts[parts.length - 2] : last;
}

export function diskCards(v: DiskView, timeZone?: string): DiskCard[] {
  const t = diskTiles(v);
  const usage = v.total > 0 ? Math.round(((v.total - v.free) / v.total) * 100) : 0;
  const reclaim = v.rows.filter((r) => r.Action !== "keep").length;
  const cards: DiskCard[] = [
    { title: "Volume", value: t.free, sub: usage + "%", usage },
    { title: "Worktrees", value: String(v.rows.length), sub: t.worktrees, usage: null },
    { title: "Reclaimable", value: t.reclaimable, sub: reclaim + (reclaim === 1 ? " worktree" : " worktrees"), usage: null },
  ];
  if (v.deps_store) {
    cards.push({ title: "Shared deps store", value: sizeLabel(v.deps_store.size), sub: storeName(v.deps_store.path), usage: null });
  }
  const next = clock(v.next_cleanup, timeZone);
  cards.push(t.schedule === "off" ? { title: "Auto-cleanup", value: "Off", sub: "", usage: null } : { title: "Auto-cleanup", value: "On · " + t.schedule, sub: next ? "next at " + next : "", usage: null });
  return cards;
}

export type Tone = "green" | "peach" | "grey" | "blue";

export type DiskTableRow = {
  id: string;
  path: string;
  worktree: string;
  sessionID: string;
  session: string;
  pr: string;
  status: string;
  tone: string;
  size: string;
  ports: string;
  pgids: number[];
  plan: string;
  action: CleanupAction;
};

export function baseName(path: string): string {
  const parts = path.split("/").filter((p) => p !== "");
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function status(action: CleanupAction, pr: PullRequest | null, detached: boolean): [string, Tone] {
  if (action === "remove") {
    return ["Merged · clean", "green"];
  }
  if (action === "backup_then_ask") {
    return detached ? ["Detached", "peach"] : ["Merged · dirty", "peach"];
  }
  if (detached) {
    return ["Detached", "grey"];
  }
  if (!pr) {
    return ["No PR", "grey"];
  }
  return pr.State === "MERGED" ? ["Merged · clean", "green"] : ["Open", "blue"];
}

function clock(stamp: string | undefined, timeZone?: string): string | null {
  if (!stamp) {
    return null;
  }
  const at = new Date(stamp);
  if (Number.isNaN(at.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(at);
}

function plan(row: DiskRow, detached: boolean, removesAt: string | null): string {
  if (row.Action === "remove") {
    return removesAt ? "removes at " + removesAt : "removes in the next cleanup";
  }
  if (row.Action === "backup_then_ask") {
    return detached ? "backup branch first" : "back up then ask";
  }
  return "kept: " + row.Reason;
}

export type DiskState = { worktrees: Worktree[]; sessions: Pick<Session, "ID" | "name">[] };

export function diskRows(v: DiskView, state: DiskState | null, timeZone?: string, ports: DiskPort[] = v.ports ?? []): DiskTableRow[] {
  const removesAt = clock(v.next_cleanup, timeZone);
  const worktrees = new Map((state?.worktrees ?? []).map((w) => [w.ID, w]));
  const sessions = new Map((state?.sessions ?? []).map((s) => [s.ID, s]));
  return v.rows.map((row) => {
    const w = worktrees.get(row.WorktreeID);
    const path = w?.Path ?? row.WorktreeID;
    const own = ports.filter((p) => p.worktree === path);
    const detached = w ? w.Branch === "" : false;
    const [label, tone] = status(row.Action, w?.PR ?? null, detached);
    return {
      id: row.WorktreeID,
      path,
      worktree: baseName(path),
      sessionID: w?.SessionID ?? "",
      session: w ? (sessions.get(w.SessionID)?.name ?? "") : "",
      pr: w?.PR ? "#" + w.PR.Number : "",
      status: label,
      tone,
      size: sizeLabel(row.Size),
      ports: own.map((p) => ":" + p.port).join(" "),
      pgids: [...new Set(own.map((p) => p.pgid))].sort((a, b) => a - b),
      plan: plan(row, detached, removesAt),
      action: row.Action,
    };
  });
}

export type DiskActionKind = "session" | "shell" | "kill" | "remove" | "backup";

export type DiskAction = {
  kind: DiskActionKind;
  title: string;
  confirm: string | null;
  verb: string;
  cleanup: { path: string; backup: boolean } | null;
  pgids: number[];
};

export function diskActions(row: DiskTableRow): DiskAction[] {
  const out: DiskAction[] = [];
  if (row.sessionID !== "") {
    out.push({ kind: "session", title: "Go to session", confirm: null, verb: "", cleanup: null, pgids: [] });
    out.push({ kind: "shell", title: "Open shell", confirm: null, verb: "", cleanup: null, pgids: [] });
  }
  if (row.pgids.length > 0) {
    const servers = row.ports.includes(" ") ? "dev servers on " + row.ports : "dev server on " + row.ports;
    out.push({ kind: "kill", title: "Kill dev servers", confirm: "Stop the " + servers + " in " + row.worktree + "?", verb: "Kill", cleanup: null, pgids: row.pgids });
  }
  if (row.action === "remove") {
    out.push({
      kind: "remove",
      title: "Remove…",
      confirm: "Remove " + row.worktree + "? It goes to the crew trash; the branch stays.",
      verb: "Remove",
      cleanup: { path: row.path, backup: false },
      pgids: [],
    });
  }
  if (row.action === "backup_then_ask") {
    out.push({
      kind: "backup",
      title: "Back up and remove…",
      confirm: "Back up " + row.worktree + " and remove it? The backup goes to the crew backups folder.",
      verb: "Back up and remove",
      cleanup: { path: row.path, backup: true },
      pgids: [],
    });
  }
  return out;
}

export type DiskPortRow = { key: string; port: number; pgid: number; command: string; worktree: string; session: string };

export function diskPorts(ports: DiskPort[], sessions: Pick<Session, "ID" | "name">[]): DiskPortRow[] {
  const names = new Map(sessions.map((s) => [s.ID, s.name]));
  return ports
    .map((p) => ({ key: p.port + "-" + p.pgid, port: p.port, pgid: p.pgid, command: p.command, worktree: baseName(p.worktree), session: names.get(p.session) ?? "" }))
    .sort((a, b) => a.port - b.port);
}

export function killAction(p: DiskPortRow): DiskAction {
  return { kind: "kill", title: "Stop…", confirm: "Stop the dev server on :" + p.port + " in " + p.worktree + "?", verb: "Stop", cleanup: null, pgids: [p.pgid] };
}

function elapsed(seconds: number): string {
  const s = Math.max(seconds, 0);
  if (s < 60) {
    return s + "s";
  }
  if (s < 3600) {
    return Math.floor(s / 60) + "m";
  }
  return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
}

export type DiskRecentRow = { key: string; worktree: string; branch: string; when: string; outcome: string };

export function diskRecent(v: DiskView, now: number): DiskRecentRow[] {
  return v.recent.map((r) => {
    const at = Date.parse(r.at);
    return {
      key: r.at + r.path,
      worktree: baseName(r.path),
      branch: r.branch ?? "",
      when: Number.isNaN(at) ? "" : elapsed(Math.floor((now - at) / 1000)) + " ago",
      outcome: r.outcome,
    };
  });
}

export function pollDelay(v: DiskView | null): number {
  if (!v) {
    return 2000;
  }
  const pending = v.worktrees_pending > 0 || v.reclaimable_pending > 0 || (v.deps_store !== undefined && v.deps_store.size < 0);
  return pending ? 2000 : 10000;
}
