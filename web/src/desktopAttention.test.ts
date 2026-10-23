import { describe, expect, it } from "vitest";
import {
  attentionMenu,
  bannerStep,
  defaultAlertPrefs,
  loadAlertPrefs,
  saveAlertPrefs,
  viewFor,
  type AlertPrefs,
} from "./desktopAttention";
import type { Alert, Quota, Session, StreamState } from "./stream";

const now = Date.parse("2026-10-03T12:00:00Z");

function session(over: Partial<Session>): Session {
  return {
    ID: "s",
    TaskID: "t",
    Harness: "claude",
    Pane: "",
    Model: "",
    Effort: "",
    State: "idle",
    Ended: false,
    Unread: false,
    Focused: false,
    Muted: false,
    WorktreeIDs: null,
    ResumeID: "",
    Transcript: "",
    Dir: "",
    Usage: { ContextLeftPercent: 0, HasContext: false, LimitUsedPercent: 0 },
    Limits: null,
    LimitsAt: "0001-01-01T00:00:00Z",
    Switches: null,
    SwitchWarning: false,
    name: "",
    where: "",
    banner: "",
    since: null,
    ...over,
  };
}

function quota(over: Partial<Quota>): Quota {
  return {
    Harness: "claude",
    Window: "five_hour",
    LeftPercent: 60,
    ResetsAt: 0,
    ReportedAt: "2026-10-03T11:59:00Z",
    label: "5h",
    low: false,
    stale_at: "2026-10-03T13:00:00Z",
    ...over,
  };
}

function state(sessions: Session[], limits: Quota[] = []): StreamState {
  return { seq: 1, workspaces: [], tasks: [], worktrees: [], sessions, limits, sends: [] };
}

const away = { session: "", front: false };

function alert(over: Partial<Alert>): Alert {
  return { id: "x", kind: "pr_checks_failed", title: "t", body: "", at: "2026-10-03T12:00:00Z", ...over };
}

class Memory {
  items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

describe("Attention banners", () => {
  it("posts nothing for the banners that were there when the app connected", () => {
    const step = bannerStep(null, [session({ ID: "a", State: "waiting", banner: "waits" })], defaultAlertPrefs, away);
    expect(step.posts).toEqual([]);
    expect(step.shown).toEqual({ a: "waits" });
  });

  it("posts one banner per session with its name, and a newer banner replaces the older one", () => {
    const first = bannerStep({}, [session({ ID: "a", name: "api", State: "permission", banner: "wants Bash" })], defaultAlertPrefs, away);
    expect(first.posts).toEqual([{ id: "a", title: "api", body: "wants Bash", kind: "permission", sound: true }]);
    const same = bannerStep(first.shown, [session({ ID: "a", name: "api", State: "permission", banner: "wants Bash" })], defaultAlertPrefs, away);
    expect(same.posts).toEqual([]);
    const next = bannerStep(same.shown, [session({ ID: "a", name: "api", State: "done", banner: "finished" })], defaultAlertPrefs, away);
    expect(next.posts).toEqual([{ id: "a", title: "api", body: "finished", kind: "other", sound: false }]);
  });

  it("forgets a banner when it goes, so the same text posts again later", () => {
    const gone = bannerStep({ a: "waits" }, [session({ ID: "a", State: "running" })], defaultAlertPrefs, away);
    expect(gone.shown).toEqual({});
    const back = bannerStep(gone.shown, [session({ ID: "a", State: "waiting", banner: "waits" })], defaultAlertPrefs, away);
    expect(back.posts.map((p) => [p.id, p.kind])).toEqual([["a", "waiting"]]);
  });

  it("skips the session in view while the app is in front, unless the setting is off", () => {
    const sessions = [session({ ID: "a", State: "waiting", banner: "waits" })];
    expect(bannerStep({}, sessions, defaultAlertPrefs, { session: "a", front: true }).posts).toEqual([]);
    expect(bannerStep({}, sessions, defaultAlertPrefs, { session: "a", front: false }).posts).toHaveLength(1);
    expect(bannerStep({}, sessions, defaultAlertPrefs, { session: "b", front: true }).posts).toHaveLength(1);
    const keep: AlertPrefs = { ...defaultAlertPrefs, skipSessionInView: false };
    expect(bannerStep({}, sessions, keep, { session: "a", front: true }).posts).toHaveLength(1);
  });

  it("applies the alert of each state and the muted setting", () => {
    const prefs: AlertPrefs = { ...defaultAlertPrefs, done: { banner: false, sound: false }, limitOrError: { banner: true, sound: true } };
    expect(bannerStep({}, [session({ ID: "a", State: "done", banner: "finished" })], prefs, away).posts).toEqual([]);
    expect(bannerStep({}, [session({ ID: "a", State: "idle", banner: "hit a limit" })], prefs, away).posts[0].sound).toBe(true);
    const muted = [session({ ID: "a", State: "waiting", Muted: true, banner: "waits" })];
    expect(bannerStep({}, muted, defaultAlertPrefs, away).posts).toEqual([]);
    expect(bannerStep({}, muted, { ...defaultAlertPrefs, notifyMuted: true }, away).posts).toHaveLength(1);
  });

  it("does not post a skipped banner later when nothing changed", () => {
    const sessions = [session({ ID: "a", State: "waiting", banner: "waits" })];
    const seen = bannerStep({}, sessions, defaultAlertPrefs, { session: "a", front: true });
    expect(bannerStep(seen.shown, sessions, defaultAlertPrefs, away).posts).toEqual([]);
  });

  it("uses the mate rows for the sessions of a mate", () => {
    const mate = { Name: "ada" };
    const prefs: AlertPrefs = {
      ...defaultAlertPrefs,
      mateNeeds: { banner: true, sound: true },
      mateDone: { banner: false, sound: false },
      permission: { banner: false, sound: false },
    };
    const asks = bannerStep({}, [session({ ID: "a", name: "ada", State: "permission", Mate: mate, banner: "wants Bash" })], prefs, away);
    expect(asks.posts).toEqual([{ id: "a", title: "ada", body: "wants Bash", kind: "permission", sound: true }]);
    expect(bannerStep({}, [session({ ID: "a", State: "waiting", Mate: mate, banner: "asks" })], prefs, away).posts).toHaveLength(1);
    expect(bannerStep({}, [session({ ID: "a", State: "done", Mate: mate, banner: "finished" })], prefs, away).posts).toEqual([]);
    expect(bannerStep({}, [session({ ID: "a", State: "done", banner: "finished" })], prefs, away).posts).toHaveLength(1);
  });

  it("posts each new alert one time, with the setting of its kind", () => {
    const pr = alert({ id: "p1", kind: "pr_checks_failed", title: "PR #42 checks failed", body: "lint", session: "a" });
    const auto = alert({ id: "r1", kind: "automation_failed", title: "Automation fix-ci failed", body: "no repo" });
    const first = bannerStep(null, [], defaultAlertPrefs, away, [pr]);
    expect(first.posts).toEqual([]);
    const next = bannerStep(first.shown, [], defaultAlertPrefs, away, [pr, auto]);
    expect(next.posts).toEqual([{ id: "r1", title: "Automation fix-ci failed", body: "no repo", kind: "other", sound: true }]);
    expect(bannerStep(next.shown, [], defaultAlertPrefs, away, [pr, auto]).posts).toEqual([]);
    const off: AlertPrefs = { ...defaultAlertPrefs, prChecksFailed: { banner: false, sound: false } };
    expect(bannerStep({}, [], off, away, [pr]).posts).toEqual([]);
    expect(bannerStep({}, [], defaultAlertPrefs, away, [pr]).posts.map((p) => p.title)).toEqual(["PR #42 checks failed"]);
  });

  it("keeps the quiet rules for an alert of a session", () => {
    const pr = alert({ id: "p1", kind: "pr_checks_failed", session: "a" });
    expect(bannerStep({}, [], defaultAlertPrefs, { session: "a", front: true }, [pr]).posts).toEqual([]);
    const muted = [session({ ID: "a", Muted: true })];
    expect(bannerStep({}, muted, defaultAlertPrefs, away, [pr]).posts).toEqual([]);
    expect(bannerStep({}, muted, { ...defaultAlertPrefs, notifyMuted: true }, away, [pr]).posts).toHaveLength(1);
  });

  it("leaves out ended sessions", () => {
    const step = bannerStep({}, [session({ ID: "a", State: "done", Ended: true, banner: "finished" })], defaultAlertPrefs, away);
    expect(step.posts).toEqual([]);
    expect(step.shown).toEqual({});
  });
});

describe("Attention settings", () => {
  it("defaults to the Mac app's settings and keeps a change", () => {
    const storage = new Memory();
    expect(loadAlertPrefs(storage)).toEqual(defaultAlertPrefs);
    expect(defaultAlertPrefs.permission).toEqual({ banner: true, sound: true });
    expect(defaultAlertPrefs.waiting).toEqual({ banner: true, sound: false });
    expect(defaultAlertPrefs.done).toEqual({ banner: true, sound: false });
    expect(defaultAlertPrefs.limitOrError).toEqual({ banner: true, sound: false });
    expect(defaultAlertPrefs.skipSessionInView).toBe(true);
    expect(defaultAlertPrefs.notifyMuted).toBe(false);
    const changed = { ...defaultAlertPrefs, notifyMuted: true };
    saveAlertPrefs(storage, changed);
    expect(loadAlertPrefs(storage)).toEqual(changed);
  });

  it("falls back to the defaults for a broken value", () => {
    const storage = new Memory();
    storage.setItem("crew.alerts", "{not json");
    expect(loadAlertPrefs(storage)).toEqual(defaultAlertPrefs);
    storage.setItem("crew.alerts", JSON.stringify({ waiting: { banner: false, sound: true } }));
    expect(loadAlertPrefs(storage)).toEqual({ ...defaultAlertPrefs, waiting: { banner: false, sound: true } });
  });
});

describe("Attention view", () => {
  it("reports the session of the route, and front only when the window is shown and focused", () => {
    expect(viewFor("#/sessions/a%2Fb", true, true)).toEqual({ session: "a/b", front: true });
    expect(viewFor("#/sessions/a", true, false)).toEqual({ session: "a", front: false });
    expect(viewFor("#/sessions/a", false, true)).toEqual({ session: "a", front: false });
    expect(viewFor("#/", true, true)).toEqual({ session: "", front: true });
  });
});

describe("Attention menu", () => {
  it("lists needs you, done and unread, working, the meters, and counts the badge", () => {
    const menu = attentionMenu(
      state(
        [
          session({ ID: "w", name: "web", where: "web@main", State: "waiting", since: "2026-10-03T11:50:00Z" }),
          session({ ID: "p", name: "api", where: "api@fix", State: "permission" }),
          session({ ID: "d", name: "docs", State: "done", Unread: true }),
          session({ ID: "r", name: "read", State: "done" }),
          session({ ID: "x", name: "run", State: "running" }),
          session({ ID: "e", name: "gone", State: "waiting", Ended: true }),
        ],
        [quota({ LeftPercent: 30, low: true }), quota({ Harness: "codex", label: "weekly", ResetsAt: now / 1000 - 60 })],
      ),
      now,
    );
    expect(menu.needsYou).toEqual([
      { id: "p", name: "api", where: "api@fix", permission: true },
      { id: "w", name: "web", where: "web@main", permission: false },
    ]);
    expect(menu.doneUnread.map((r) => r.id)).toEqual(["d"]);
    expect(menu.working.map((r) => r.id)).toEqual(["x"]);
    expect(menu.meters).toEqual([{ title: "Claude 5h", caption: "70%", low: true }]);
    expect(menu.badge).toBe(2);
  });

  it("is empty with no state", () => {
    expect(attentionMenu(undefined, now)).toEqual({ needsYou: [], doneUnread: [], working: [], meters: [], badge: 0 });
  });
});
