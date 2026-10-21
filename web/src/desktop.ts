import type { Session, StreamState } from "./stream";

export type MainTab = "chat" | "terminal" | "review" | "shell" | "nvim" | "browser";

export type TabSpec = { id: MainTab; title: string; needs: string | null };

export const mainTabs: TabSpec[] = [
  { id: "chat", title: "Chat", needs: "Start or select a session to see its chat" },
  { id: "terminal", title: "Terminal", needs: null },
  { id: "review", title: "Review", needs: "Start or select a session to review its changes" },
  { id: "shell", title: "Shell", needs: "Start or select a session to open a shell in its worktree" },
  { id: "nvim", title: "nvim", needs: "Start or select a session to open nvim in its worktree" },
  { id: "browser", title: "Browser", needs: "Start or select a session to open its browser" },
];

export type SidebarRows = { live: Session[]; ended: Session[] };

function needsYou(s: Session): boolean {
  return s.State === "permission" || s.State === "waiting";
}

export function sidebarRows(sessions: Session[]): SidebarRows {
  const live = sessions.filter((s) => !s.Ended);
  const ended = sessions.filter((s) => s.Ended);
  const ordered = live.some((s) => typeof s.order === "number")
    ? live.slice().sort((a, b) => rank(a) - rank(b))
    : [...live.filter(needsYou), ...live.filter((s) => !needsYou(s))];
  return { live: ordered, ended };
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
      detail: "Start a session to see its chat and terminal, review its changes, or open a shell or nvim.",
      offersNew: true,
    };
  }
  return {
    title: "Select a session",
    detail: "Pick one in the sidebar (" + shortcut + "1–9) to see its chat, terminal, review, shell or nvim.",
    offersNew: true,
  };
}

export type Keys = { label: string; aria: string };

export function modifierKeys(userAgent: string): Keys {
  return /Macintosh/.test(userAgent) ? { label: "⌘", aria: "Meta" } : { label: "Ctrl+", aria: "Control" };
}

export type KeyAction = { kind: "select"; index: number } | { kind: "next" } | { kind: "new" } | null;

export function keyAction(e: { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): KeyAction {
  if (e.altKey) {
    return null;
  }
  if (e.ctrlKey && !e.metaKey && (e.key === " " || e.code === "Space")) {
    return { kind: "next" };
  }
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey) {
    return null;
  }
  if (/^[1-9]$/.test(e.key)) {
    return { kind: "select", index: Number(e.key) - 1 };
  }
  if (e.key.toLowerCase() === "n") {
    return { kind: "new" };
  }
  return null;
}
