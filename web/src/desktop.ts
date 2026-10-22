import type { Session, StreamState } from "./stream";

export type MainTab = "chat" | "review";

export type TabSpec = { id: MainTab; title: string; needs: string | null };

export const mainTabs: TabSpec[] = [
  { id: "chat", title: "Chat", needs: "Start or select a session to see its chat" },
  { id: "review", title: "Changes", needs: "Start or select a session to review its changes" },
];

export type SidebarRows = { live: Session[]; ended: Session[] };

export type SidebarGroups = { needs: Session[]; running: Session[]; done: Session[] };

export type Dot = "ask" | "wait" | "run" | "ok" | "";

export function stateDot(s: Session): Dot {
  if (s.Ended) {
    return "";
  }
  const dots: Record<string, Dot> = { permission: "ask", waiting: "wait", running: "run", done: "ok" };
  return dots[s.State] ?? "";
}

export function sidebarGroups(sessions: Session[]): SidebarGroups {
  const { live, ended } = sidebarRows(sessions);
  return {
    needs: live.filter(needsYou),
    running: live.filter((s) => !needsYou(s) && s.State !== "done"),
    done: [...live.filter((s) => s.State === "done"), ...ended],
  };
}

export function sessionPlace(where: string): { repo: string; sub: string } {
  const at = where.indexOf("@");
  return at < 0 ? { repo: where, sub: where } : { repo: where.slice(0, at), sub: where.slice(0, at) + " · " + where.slice(at + 1) };
}

function needsYou(s: Session): boolean {
  return s.State === "permission" || s.State === "waiting";
}

export function sidebarRows(sessions: Session[]): SidebarRows {
  const all = sessions.filter((s) => !s.Ended);
  const ordered = all.some((s) => typeof s.order === "number") ? all.slice().sort((a, b) => rank(a) - rank(b)) : [...all.filter(needsYou), ...all.filter((s) => !needsYou(s))];
  const live = [...ordered.filter(needsYou), ...ordered.filter((s) => !needsYou(s) && s.State !== "done"), ...ordered.filter((s) => !needsYou(s) && s.State === "done")];
  const ended = sessions.filter((s) => s.Ended);
  return { live, ended };
}

function rank(s: Session): number {
  return typeof s.order === "number" && s.order >= 0 ? s.order : Number.MAX_SAFE_INTEGER;
}

export function nextNeeding(rows: Session[], current: string | null): Session | null {
  const at = rows.findIndex((s) => s.ID === current);
  const after = rows.slice(at + 1).find(needsYou);
  return after ?? rows.find(needsYou) ?? null;
}

export type EmptyMain = { title: string; detail: string; offersNew: boolean };

export function emptyMain(state: StreamState | null, live: number, shortcut: string): EmptyMain {
  if (!state) {
    return { title: "Waiting for the daemon", detail: "", offersNew: false };
  }
  if (live === 0) {
    return {
      title: "No sessions yet",
      detail: "Start a session to see its chat, review its changes, or open a shell or the editor.",
      offersNew: true,
    };
  }
  return {
    title: "Select a session",
    detail: "Pick one in the sidebar (" + shortcut + "1–9) to see its chat and its changes.",
    offersNew: true,
  };
}

export type Keys = { label: string; aria: string; mac: boolean };

export function modifierKeys(userAgent: string): Keys {
  return /Macintosh/.test(userAgent) ? { label: "⌘", aria: "Meta", mac: true } : { label: "Ctrl+Shift+", aria: "Control+Shift", mac: false };
}

export type KeyAction = { kind: "select"; index: number } | { kind: "next" } | { kind: "new" } | { kind: "shell" } | { kind: "editor" } | null;

export type KeyInput = { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean };

function keyName(e: KeyInput): string {
  const code = e.code ?? "";
  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5);
  }
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3).toLowerCase();
  }
  if (code === "Space") {
    return " ";
  }
  if (code === "Backquote") {
    return "`";
  }
  return e.key.toLowerCase();
}

export function keyAction(e: KeyInput, mac: boolean): KeyAction {
  if (e.altKey) {
    return null;
  }
  const key = keyName(e);
  if (key === " ") {
    const next = mac ? e.ctrlKey && !e.metaKey && !e.shiftKey : e.ctrlKey && e.shiftKey && !e.metaKey;
    return next ? { kind: "next" } : null;
  }
  if (key === "`") {
    return e.ctrlKey && !e.metaKey && !e.shiftKey ? { kind: "shell" } : null;
  }
  const held = mac ? e.metaKey && !e.ctrlKey && !e.shiftKey : e.ctrlKey && e.shiftKey && !e.metaKey;
  if (!held) {
    return null;
  }
  if (/^[1-9]$/.test(key)) {
    return { kind: "select", index: Number(key) - 1 };
  }
  if (key === "n") {
    return { kind: "new" };
  }
  if (key === "t") {
    return { kind: "shell" };
  }
  if (key === "e") {
    return { kind: "editor" };
  }
  return null;
}
