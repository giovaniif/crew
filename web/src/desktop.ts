import type { Session, StreamState } from "./stream";

export type MainTab = "chat" | "terminal" | "review" | "shell" | "nvim" | "browser";

export type TabSpec = { id: MainTab; title: string; needs: string | null };

export const mainTabs: TabSpec[] = [
  { id: "chat", title: "Chat", needs: "Start or select a session to see its chat" },
  { id: "terminal", title: "Terminal", needs: "Start or select a session to see its terminal" },
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

export type Keys = { label: string; aria: string; mac: boolean };

export function modifierKeys(userAgent: string): Keys {
  return /Macintosh/.test(userAgent) ? { label: "⌘", aria: "Meta", mac: true } : { label: "Ctrl+Shift+", aria: "Control+Shift", mac: false };
}

export type KeyAction = { kind: "select"; index: number } | { kind: "next" } | { kind: "new" } | { kind: "tab"; tab: MainTab } | null;

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
    return { kind: "tab", tab: "shell" };
  }
  if (key === "e") {
    return { kind: "tab", tab: "nvim" };
  }
  return null;
}
