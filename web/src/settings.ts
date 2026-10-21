import type { KeyValue } from "./auth";
import { defaultShortcuts, type Shortcuts } from "./shortcuts";

export type General = {
  endedShown: number;
  showWorktrees: boolean;
  showSubagents: boolean;
};

export type EventAlert = { banner: boolean; sound: boolean };

export type NotificationSettings = {
  permission: EventAlert;
  waiting: EventAlert;
  done: EventAlert;
  limitOrError: EventAlert;
  skipSessionInView: boolean;
  notifyMuted: boolean;
};

export type ThemeChoice = "system" | "latte" | "mocha";

export type Appearance = {
  theme: ThemeChoice;
  accent: "blue" | "peach" | "green" | "red";
  terminalFont: string;
  fontSize: number;
  lineHeight: number;
  cursor: "block" | "bar" | "underline";
  cursorBlinks: boolean;
  density: "regular" | "compact";
  diffLayout: "unified" | "split";
};

export type AppSettings = {
  general: General;
  notifications: NotificationSettings;
  appearance: Appearance;
  shortcuts: Shortcuts;
};

export const fontSizes = { min: 9, max: 24 };
export const lineHeights = { min: 1, max: 2 };

export function defaultSettings(): AppSettings {
  return {
    general: { endedShown: 10, showWorktrees: true, showSubagents: false },
    notifications: {
      permission: { banner: true, sound: true },
      waiting: { banner: true, sound: false },
      done: { banner: true, sound: false },
      limitOrError: { banner: true, sound: false },
      skipSessionInView: true,
      notifyMuted: false,
    },
    appearance: {
      theme: "system",
      accent: "blue",
      terminalFont: "JetBrains Mono",
      fontSize: 12,
      lineHeight: 1.2,
      cursor: "block",
      cursorBlinks: true,
      density: "regular",
      diffLayout: "unified",
    },
    shortcuts: defaultShortcuts(),
  };
}

export function clamp(value: number, range: { min: number; max: number }): number {
  if (Number.isNaN(value)) {
    return range.min;
  }
  return Math.min(Math.max(value, range.min), range.max);
}

const settingsKey = "crew.settings";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function merge<T>(base: T, saved: unknown): T {
  if (!isObject(base) || !isObject(saved)) {
    return base;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(base)) {
    if (!(k in saved)) {
      continue;
    }
    const s = saved[k];
    if (isObject(v)) {
      out[k] = k === "bindings" && isObject(s) ? s : merge(v, s);
    } else if (typeof s === typeof v) {
      out[k] = s;
    }
  }
  return out as T;
}

export function loadSettings(storage: KeyValue): AppSettings {
  try {
    const raw = storage.getItem(settingsKey);
    return raw ? merge(defaultSettings(), JSON.parse(raw)) : defaultSettings();
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(storage: KeyValue, s: AppSettings): void {
  try {
    storage.setItem(settingsKey, JSON.stringify(s));
  } catch {
    return;
  }
}

export function themeAttribute(theme: ThemeChoice): "light" | "dark" | null {
  return theme === "latte" ? "light" : theme === "mocha" ? "dark" : null;
}

export function applyTheme(theme: ThemeChoice, root: HTMLElement = document.documentElement): void {
  const value = themeAttribute(theme);
  if (value) {
    root.dataset.theme = value;
  } else {
    delete root.dataset.theme;
  }
}
