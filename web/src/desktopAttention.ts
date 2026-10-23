import type { KeyValue } from "./auth";
import { parseRoute } from "./route";
import { groupSessions, limitRows } from "./sessions";
import type { Alert, Session, StreamState } from "./stream";

export type EventAlert = { banner: boolean; sound: boolean };

export type AlertPrefs = {
  permission: EventAlert;
  waiting: EventAlert;
  done: EventAlert;
  limitOrError: EventAlert;
  mateNeeds: EventAlert;
  mateDone: EventAlert;
  automationFailed: EventAlert;
  prChecksFailed: EventAlert;
  skipSessionInView: boolean;
  notifyMuted: boolean;
};

export const defaultAlertPrefs: AlertPrefs = {
  permission: { banner: true, sound: true },
  waiting: { banner: true, sound: false },
  done: { banner: true, sound: false },
  limitOrError: { banner: true, sound: false },
  mateNeeds: { banner: true, sound: true },
  mateDone: { banner: false, sound: false },
  automationFailed: { banner: true, sound: true },
  prChecksFailed: { banner: true, sound: true },
  skipSessionInView: true,
  notifyMuted: false,
};

const prefsKey = "crew.alerts";

function alertFor(prefs: AlertPrefs, state: string, mate: boolean): EventAlert {
  if (mate && (state === "permission" || state === "waiting")) {
    return prefs.mateNeeds;
  }
  if (mate && state === "done") {
    return prefs.mateDone;
  }
  switch (state) {
    case "permission":
      return prefs.permission;
    case "waiting":
      return prefs.waiting;
    case "done":
      return prefs.done;
    default:
      return prefs.limitOrError;
  }
}

export function loadAlertPrefs(storage: KeyValue): AlertPrefs {
  try {
    const raw = storage.getItem(prefsKey);
    if (!raw) {
      return defaultAlertPrefs;
    }
    const value = JSON.parse(raw) as Partial<AlertPrefs>;
    return { ...defaultAlertPrefs, ...value };
  } catch {
    return defaultAlertPrefs;
  }
}

export function saveAlertPrefs(storage: KeyValue, prefs: AlertPrefs): void {
  try {
    storage.setItem(prefsKey, JSON.stringify(prefs));
  } catch {
    return;
  }
}

export type View = { session: string; front: boolean };

export function viewFor(hash: string, visible: boolean, focused: boolean): View {
  const route = parseRoute(hash);
  return { session: route.screen === "session" ? route.id : "", front: visible && focused };
}

export type BannerPost = { id: string; title: string; body: string; kind: "permission" | "waiting" | "other"; sound: boolean };

export type BannerStep = { posts: BannerPost[]; shown: Record<string, string> };

function kindOf(state: string): BannerPost["kind"] {
  return state === "permission" || state === "waiting" ? state : "other";
}

function alertPref(prefs: AlertPrefs, kind: string): EventAlert {
  return kind === "automation_failed" ? prefs.automationFailed : prefs.prChecksFailed;
}

export function bannerStep(
  shown: Record<string, string> | null,
  sessions: Session[],
  prefs: AlertPrefs,
  view: View,
  alerts: Alert[] = [],
): BannerStep {
  const next: Record<string, string> = {};
  const posts: BannerPost[] = [];
  for (const s of sessions) {
    if (s.Ended || !s.banner) {
      continue;
    }
    next[s.ID] = s.banner;
    if (shown === null || shown[s.ID] === s.banner) {
      continue;
    }
    const alert = alertFor(prefs, s.State, !!s.Mate);
    const inView = prefs.skipSessionInView && view.front && view.session === s.ID;
    const muted = s.Muted && !prefs.notifyMuted;
    if (inView || muted || !alert.banner) {
      continue;
    }
    posts.push({ id: s.ID, title: s.name || "crew", body: s.banner, kind: kindOf(s.State), sound: alert.sound });
  }
  for (const a of alerts) {
    const key = "alert:" + a.id;
    next[key] = a.id;
    if (shown === null || shown[key] === a.id) {
      continue;
    }
    const pref = alertPref(prefs, a.kind);
    const owner = sessions.find((s) => s.ID === a.session);
    const inView = !!a.session && prefs.skipSessionInView && view.front && view.session === a.session;
    const muted = !!owner?.Muted && !prefs.notifyMuted;
    if (inView || muted || !pref.banner) {
      continue;
    }
    posts.push({ id: a.id, title: a.title, body: a.body, kind: "other", sound: pref.sound });
  }
  return { posts, shown: next };
}

export type AttentionRow = { id: string; name: string; where: string; permission: boolean };

export type Meter = { title: string; caption: string; low: boolean };

export type AttentionMenu = {
  needsYou: AttentionRow[];
  doneUnread: AttentionRow[];
  working: AttentionRow[];
  meters: Meter[];
  badge: number;
};

function row(s: Session): AttentionRow {
  return { id: s.ID, name: s.name, where: s.where, permission: s.State === "permission" };
}

export function attentionMenu(state: StreamState | null | undefined, now: number): AttentionMenu {
  if (!state) {
    return { needsYou: [], doneUnread: [], working: [], meters: [], badge: 0 };
  }
  const groups = groupSessions(state.sessions);
  const group = (key: string) => groups.find((g) => g.key === key)?.sessions ?? [];
  const needsYou = group("needs").map(row);
  const meters = limitRows(state.limits, now).flatMap((r) =>
    r.windows.map((w) => ({
      title: [r.harness.charAt(0).toUpperCase() + r.harness.slice(1), w.label].filter(Boolean).join(" "),
      caption: w.used + "%" + (w.resets ? " · resets " + w.resets : ""),
      low: w.low,
    })),
  );
  return {
    needsYou,
    doneUnread: group("done").filter((s) => s.Unread).map(row),
    working: group("working").map(row),
    meters,
    badge: needsYou.length,
  };
}
