import { useEffect, useRef, useState } from "react";
import type { KeyValue } from "./auth";
import { attentionMenu, bannerStep, loadAlertPrefs, saveAlertPrefs, viewFor, type AlertPrefs, type EventAlert } from "./desktopAttention";
import type { StreamClient, StreamSnapshot } from "./stream";
import { Checkbox } from "./ui";

export type DesktopBridge = {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  focused: () => boolean;
  onFocusChange: (listener: () => void) => () => void;
};

type TauriInternals = {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
};

export function tauriBridge(win: Window): DesktopBridge | undefined {
  const internals = (win as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  if (!internals || typeof internals.invoke !== "function") {
    return undefined;
  }
  return {
    invoke: (cmd, args) => internals.invoke(cmd, args),
    focused: () => win.document.hasFocus(),
    onFocusChange: (listener) => {
      win.addEventListener("focus", listener);
      win.addEventListener("blur", listener);
      return () => {
        win.removeEventListener("focus", listener);
        win.removeEventListener("blur", listener);
      };
    },
  };
}

type Visibility = {
  visible: () => boolean;
  onChange: (listener: () => void) => () => void;
};

export function useDesktopAttention(
  desktop: DesktopBridge | undefined,
  client: StreamClient,
  snapshot: StreamSnapshot,
  hash: string,
  storage: KeyValue,
  visibility: Visibility | undefined,
  now: number,
): void {
  const shown = useRef<Record<string, string> | null>(null);
  const menuSent = useRef("");
  const [focus, setFocus] = useState(0);
  const view = desktop ? viewFor(hash, visibility ? visibility.visible() : true, desktop.focused()) : null;
  const viewKey = view ? view.session + "\u0000" + view.front : "";

  useEffect(() => {
    if (!desktop) {
      return;
    }
    const changed = () => setFocus((n) => n + 1);
    const offFocus = desktop.onFocusChange(changed);
    const offVisible = visibility?.onChange(changed);
    return () => {
      offFocus();
      offVisible?.();
    };
  }, [desktop, visibility]);

  useEffect(() => {
    if (view && snapshot.status === "live") {
      client.send({ viewing: view });
    }
  }, [client, snapshot.status, viewKey, focus]);

  useEffect(() => {
    if (!desktop || !view) {
      return;
    }
    if (snapshot.status !== "live" || !snapshot.state) {
      shown.current = null;
      return;
    }
    const step = bannerStep(shown.current, snapshot.state.sessions, loadAlertPrefs(storage), view);
    shown.current = step.shown;
    for (const banner of step.posts) {
      void desktop.invoke("crew_notify", { banner }).catch(() => undefined);
    }
  }, [desktop, snapshot.status, snapshot.state, storage, viewKey]);

  useEffect(() => {
    if (!desktop) {
      return;
    }
    const menu = attentionMenu(snapshot.state, now);
    const key = JSON.stringify(menu);
    if (key === menuSent.current) {
      return;
    }
    menuSent.current = key;
    void desktop.invoke("crew_attention", { menu }).catch(() => undefined);
  }, [desktop, snapshot.state, now]);
}

const events: {
  key: "permission" | "waiting" | "done" | "limitOrError";
  label: string;
}[] = [
  { key: "permission", label: "needs permission" },
  { key: "waiting", label: "waits for you" },
  { key: "done", label: "is done" },
  { key: "limitOrError", label: "hits a limit or an error" },
];

export function DesktopAlerts({ storage }: { storage: KeyValue }) {
  const [prefs, setPrefs] = useState<AlertPrefs>(() => loadAlertPrefs(storage));
  const change = (next: AlertPrefs) => {
    saveAlertPrefs(storage, next);
    setPrefs(next);
  };
  const setAlert = (key: (typeof events)[number]["key"], alert: EventAlert) => change({ ...prefs, [key]: alert });
  return (
    <main className="screen">
      <section className="card" aria-label="Desktop notifications">
        <h2>Desktop notifications</h2>
        {events.map(({ key, label }) => (
          <p key={key}>
            <Checkbox label={"Banner when a session " + label} checked={prefs[key].banner} onChange={(banner) => setAlert(key, { ...prefs[key], banner })} />{" "}
            <Checkbox label="Sound" ariaLabel={"Sound when a session " + label} checked={prefs[key].sound} onChange={(sound) => setAlert(key, { ...prefs[key], sound })} />
          </p>
        ))}
        <p>
          <Checkbox label="No banner for the session on screen" checked={prefs.skipSessionInView} onChange={(skipSessionInView) => change({ ...prefs, skipSessionInView })} />
        </p>
        <p>
          <Checkbox label="Banners for muted sessions" checked={prefs.notifyMuted} onChange={(notifyMuted) => change({ ...prefs, notifyMuted })} />
        </p>
      </section>
    </main>
  );
}
