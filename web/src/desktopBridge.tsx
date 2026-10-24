import { useEffect, useRef, useState } from "react";
import type { KeyValue } from "./auth";
import { attentionMenu, bannerStep, loadAlertPrefs, viewFor } from "./desktopAttention";
import type { StreamClient, StreamSnapshot } from "./stream";

export type DesktopBridge = {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  listen?: (event: string, handler: (payload: unknown) => void) => Promise<() => void>;
  focused: () => boolean;
  onFocusChange: (listener: () => void) => () => void;
};

type TauriInternals = {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  transformCallback: (cb: (event: { payload: unknown }) => void) => number;
};

export function tauriBridge(win: Window): DesktopBridge | undefined {
  const internals = (win as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  if (!internals || typeof internals.invoke !== "function") {
    return undefined;
  }
  return {
    invoke: (cmd, args) => internals.invoke(cmd, args),
    listen: async (event, handler) => {
      const id = internals.transformCallback((e) => handler(e.payload));
      const eventId = await internals.invoke("plugin:event|listen", { event, target: { kind: "Any" }, handler: id });
      return () => {
        void internals.invoke("plugin:event|unlisten", { event, eventId }).catch(() => undefined);
      };
    },
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
    const step = bannerStep(shown.current, snapshot.state.sessions, loadAlertPrefs(storage), view, snapshot.state.alerts ?? []);
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
