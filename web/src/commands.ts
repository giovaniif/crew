import type { KeyValue } from "./auth";
import type { Session } from "./stream";

export type Command = "rename" | "mute" | "model" | "effort" | "agent" | "editor" | "browser" | "kill" | "interrupt" | "end" | "resume";

export type CommandItem = { id: Command; title: string; hint?: string };

export type CommandEntry = CommandItem | "sep";

const confirmEndKey = "crew.confirmEnd";

export const noDevServers = "No dev servers are running in this session's worktrees.";

export function commandItems(s: Session): CommandEntry[] {
  if (s.Ended) {
    return [{ id: "resume", title: "Resume" }];
  }
  return [
    { id: "rename", title: "Rename…", hint: "F2" },
    { id: "mute", title: s.Muted ? "Unmute" : "Mute" },
    { id: "model", title: "Model…", hint: s.Model || undefined },
    { id: "effort", title: "Effort…", hint: s.Effort || undefined },
    "sep",
    { id: "agent", title: "Show agent screen" },
    { id: "editor", title: "Open in editor", hint: "⌘E" },
    { id: "browser", title: "Open browser" },
    { id: "kill", title: "Kill dev servers" },
    "sep",
    { id: "interrupt", title: "Interrupt", hint: "Esc" },
    { id: "end", title: "End session…" },
  ];
}

export function confirmEnd(storage: KeyValue): boolean {
  try {
    return storage.getItem(confirmEndKey) !== "off";
  } catch {
    return true;
  }
}

export function setConfirmEnd(storage: KeyValue, on: boolean): void {
  try {
    if (on) {
      storage.removeItem(confirmEndKey);
    } else {
      storage.setItem(confirmEndKey, "off");
    }
  } catch {
    return;
  }
}

export function killedNote(killed: number[]): string {
  if (killed.length === 0) {
    return noDevServers;
  }
  return "Stopped " + killed.length + (killed.length === 1 ? " dev server." : " dev servers.");
}
