export type Mod = "ctrl" | "alt" | "shift" | "meta";

export type Combo = { key: string; mods: Mod[] };

export type ShortcutAction = { id: string; title: string; combo: Combo };

const modOrder: Mod[] = ["ctrl", "alt", "shift", "meta"];

const c = (key: string, ...mods: Mod[]): Combo => ({ key, mods });

export const shortcutActions: ShortcutAction[] = [
  { id: "nextWaiting", title: "Next waiting session", combo: c("space", "ctrl") },
  { id: "lastSession", title: "Last session", combo: c("[", "meta") },
  { id: "filter", title: "Filter sessions", combo: c("k", "meta") },
  { id: "newSession", title: "New session", combo: c("n", "meta") },
  { id: "review", title: "Review", combo: c("r", "meta") },
  { id: "shellSplit", title: "Shell in worktree (split)", combo: c("t", "meta") },
  { id: "shellPopup", title: "Shell in worktree (popup)", combo: c("t", "shift", "meta") },
  { id: "nvimAtFile", title: "nvim at file", combo: c("e", "meta") },
  { id: "rename", title: "Rename and pin", combo: c("r", "shift", "meta") },
  { id: "model", title: "Model", combo: c("m", "ctrl", "meta") },
  { id: "effort", title: "Effort", combo: c("e", "ctrl", "meta") },
  { id: "mute", title: "Mute", combo: c("m", "alt", "meta") },
  { id: "endSession", title: "End session", combo: c("delete", "meta") },
  { id: "resumeEnded", title: "Resume ended", combo: c("u", "shift", "meta") },
  { id: "worktrees", title: "Worktrees and disk", combo: c("w", "shift", "meta") },
  { id: "killDevServers", title: "Kill session's dev servers", combo: c("k", "alt", "meta") },
  { id: "inspector", title: "Inspector", combo: c("i", "alt", "meta") },
  { id: "backToSidebar", title: "Back to sidebar from terminal", combo: c("0", "meta") },
];

const fixed: { combo: Combo; title: string }[] = [
  { combo: c("s", "ctrl", "meta"), title: "Show the sidebar in review" },
  { combo: c("return", "shift", "meta"), title: "Send review" },
  { combo: c(",", "meta"), title: "Settings" },
];

export const sessionJumps = "Jump to session N";

export type Shortcuts = { passThrough: boolean; bindings: Record<string, Combo | null> };

export function defaultShortcuts(): Shortcuts {
  return { passThrough: true, bindings: {} };
}

export function normalize(combo: Combo): Combo {
  return { key: combo.key.toLowerCase(), mods: modOrder.filter((m) => combo.mods.includes(m)) };
}

export function sameCombo(a: Combo | null, b: Combo | null): boolean {
  if (!a || !b) {
    return false;
  }
  const x = normalize(a);
  const y = normalize(b);
  return x.key === y.key && x.mods.join("+") === y.mods.join("+");
}

export function comboFor(s: Shortcuts, id: string): Combo | null {
  if (Object.prototype.hasOwnProperty.call(s.bindings, id)) {
    return s.bindings[id];
  }
  return shortcutActions.find((a) => a.id === id)?.combo ?? null;
}

const named: Record<string, string> = { space: "Space", delete: "⌫", return: "↩", escape: "⎋", tab: "⇥" };
const namedWords: Record<string, string> = { space: "Space", delete: "Backspace", return: "Enter", escape: "Esc", tab: "Tab" };
const macMods: Record<Mod, string> = { ctrl: "⌃", alt: "⌥", shift: "⇧", meta: "⌘" };
const wordMods: Record<Mod, string> = { ctrl: "Ctrl+", alt: "Alt+", shift: "Shift+", meta: "Meta+" };

export function comboLabel(combo: Combo, mac = true): string {
  const n = normalize(combo);
  const mods = n.mods.map((m) => (mac ? macMods[m] : wordMods[m])).join("");
  const key = (mac ? named : namedWords)[n.key] ?? n.key.toUpperCase();
  return mods + key;
}

export type Assigned = { ok: true; shortcuts: Shortcuts } | { ok: false; message: string };

export function assignShortcut(s: Shortcuts, id: string, combo: Combo | null): Assigned {
  if (combo === null) {
    return { ok: true, shortcuts: { ...s, bindings: { ...s.bindings, [id]: null } } };
  }
  const n = normalize(combo);
  const label = comboLabel(n);
  if (!(n.key in named) && [...n.key].length !== 1) {
    return { ok: false, message: label + " is not a key crew can bind" };
  }
  if (!n.mods.includes("meta") && !n.mods.includes("ctrl")) {
    return { ok: false, message: label + " needs ⌘ or ⌃, so the terminal keeps plain keys" };
  }
  if (/^[1-9]$/.test(n.key) && n.mods.length === 1) {
    return { ok: false, message: label + " is already used by " + sessionJumps };
  }
  const held = fixed.find((f) => sameCombo(f.combo, n));
  if (held) {
    return { ok: false, message: label + " is already used by " + held.title };
  }
  const holder = shortcutActions.find((a) => a.id !== id && sameCombo(comboFor(s, a.id), n));
  if (holder) {
    return { ok: false, message: label + " is already used by " + holder.title };
  }
  return { ok: true, shortcuts: { ...s, bindings: { ...s.bindings, [id]: n } } };
}

export function restoreShortcut(s: Shortcuts, id: string): Shortcuts {
  const bindings = { ...s.bindings };
  delete bindings[id];
  return { ...s, bindings };
}

const keyNames: Record<string, string> = { " ": "space", Backspace: "delete", Enter: "return", Escape: "escape", Tab: "tab" };

export function comboFromEvent(e: { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): Combo | null {
  if (["Meta", "Control", "Alt", "Shift"].includes(e.key)) {
    return null;
  }
  let key = keyNames[e.key] ?? e.key.toLowerCase();
  if (e.code && /^Key[A-Z]$/.test(e.code)) {
    key = e.code.slice(3).toLowerCase();
  } else if (e.code && /^Digit[0-9]$/.test(e.code)) {
    key = e.code.slice(5);
  }
  const mods: Mod[] = [];
  if (e.ctrlKey) mods.push("ctrl");
  if (e.altKey) mods.push("alt");
  if (e.shiftKey) mods.push("shift");
  if (e.metaKey) mods.push("meta");
  return { key, mods };
}
