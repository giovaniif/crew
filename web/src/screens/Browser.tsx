import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { headlessView, sendCookies, type Authed, type HeadlessView } from "../api";
import { browserAddress, portLinks, tabLabel } from "../browser";
import type { Worktree } from "../stream";

export type BrowserTab = { id: number; url: string };
export type BrowserState = { tabs: BrowserTab[]; selected: number; next: number };
export type BrowserStore = Map<string, BrowserState>;

const sandbox = "allow-scripts allow-forms allow-same-origin allow-popups allow-modals";

const headlessEvery = 1000;

function hostName(host: string): string {
  try {
    return new URL("http://" + host).hostname || "localhost";
  } catch {
    return "localhost";
  }
}

function useHeadless(api: Authed, session: string): HeadlessView {
  const [view, setView] = useState<HeadlessView>({ live: false });
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let next: HeadlessView = { live: false };
      try {
        next = await headlessView(api, session);
      } catch {
        next = { live: false };
      }
      if (stopped) {
        return;
      }
      setView(next);
      timer = setTimeout(() => void poll(), headlessEvery);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [api, session]);
  return view;
}

type Props = { session: string; worktrees: Worktree[]; host: string; store: BrowserStore; api: Authed };

export function BrowserPane({ session, worktrees, host, store, api }: Props) {
  const name = hostName(host);
  const links = portLinks(session, worktrees, name);
  const [state, setState] = useState<BrowserState>(() => store.get(session) ?? { tabs: [{ id: 1, url: links[0]?.url ?? "" }], selected: 1, next: 2 });
  const current = state.tabs.find((t) => t.id === state.selected) ?? state.tabs[0];
  const [draft, setDraft] = useState(current.url);
  const [refused, setRefused] = useState(false);
  const headless = useHeadless(api, session);
  const [onServer, setOnServer] = useState(false);
  const [cookies, setCookies] = useState<{ ok: boolean; text: string } | null>(null);
  const showServer = onServer && headless.live;

  const save = (next: BrowserState) => {
    store.set(session, next);
    setState(next);
    setDraft(next.tabs.find((t) => t.id === next.selected)?.url ?? "");
    setRefused(false);
    setOnServer(false);
  };

  const open = (url: string) => save({ tabs: [...state.tabs, { id: state.next, url }], selected: state.next, next: state.next + 1 });

  const close = (id: number) => {
    const index = state.tabs.findIndex((t) => t.id === id);
    const tabs = state.tabs.filter((t) => t.id !== id);
    if (tabs.length === 0) {
      save({ tabs: [{ id: state.next, url: "" }], selected: state.next, next: state.next + 1 });
      return;
    }
    const selected = state.selected === id ? tabs[Math.min(index, tabs.length - 1)].id : state.selected;
    save({ ...state, tabs, selected });
  };

  const go = (e: FormEvent) => {
    e.preventDefault();
    const url = browserAddress(draft, name);
    if (url === null) {
      setRefused(true);
      return;
    }
    save({ ...state, tabs: state.tabs.map((t) => (t.id === current.id ? { ...t, url } : t)) });
  };

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) {
      return;
    }
    try {
      const out = await sendCookies(api, await file.text());
      setCookies({ ok: true, text: "Sent " + out.imported + " cookies to the server browser. It has " + out.total + " cookies." });
    } catch (err) {
      setCookies({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="browser">
      <div className="browser-tabs" role="tablist" aria-label="Browser tabs">
        {state.tabs.map((t) => {
          const label = tabLabel(t.url);
          return (
            <span key={t.id} className="browser-tab">
              <button type="button" role="tab" aria-selected={!showServer && t.id === current.id} onClick={() => save({ ...state, selected: t.id })}>
                {label}
              </button>
              <button type="button" className="browser-close" aria-label={"Close " + label} onClick={() => close(t.id)}>
                ×
              </button>
            </span>
          );
        })}
        <button type="button" className="browser-new" aria-label="New tab" onClick={() => open("")}>
          +
        </button>
        {headless.live ? (
          <span className="browser-tab browser-server">
            <button type="button" role="tab" aria-selected={showServer} onClick={() => setOnServer(true)}>
              Server browser
            </button>
          </span>
        ) : null}
      </div>
      {showServer ? (
        <div className="browser-page browser-headless">
          <p className="muted">Read-only. An agent controls this browser.</p>
          <img alt="The headless browser of the server" src={"data:image/png;base64," + (headless.png ?? "")} width={headless.width} height={headless.height} />
        </div>
      ) : (
        <>
          <form className="browser-bar" onSubmit={go}>
            <input
              type="text"
              aria-label="Address"
              value={draft}
              placeholder="Port, host or URL"
              spellCheck={false}
              autoCapitalize="off"
              onChange={(e) => {
                setDraft(e.target.value);
                setRefused(false);
              }}
            />
            {current.url ? (
              <a className="browser-external" href={current.url} target="_blank" rel="noreferrer">
                Open in browser
              </a>
            ) : null}
          </form>
          {refused ? (
            <p className="browser-refused" role="alert">
              Type a port, a host or an http or https URL
            </p>
          ) : null}
          {links.length > 0 ? (
            <ul className="browser-ports" aria-label="Ports">
              {links.map((l) => (
                <li key={l.port}>
                  <button type="button" onClick={() => open(l.url)}>
                    {l.title}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="browser-page">
            {current.url ? (
              <iframe key={current.id + current.url} title="Page" src={current.url} sandbox={sandbox} referrerPolicy="no-referrer" />
            ) : (
              <p className="muted browser-empty">{links.length === 0 ? "No process in the worktrees of this session listens on a TCP port." : "Type an address or select a port."}</p>
            )}
          </div>
        </>
      )}
      <div className="browser-foot">
        <label className="browser-cookies">
          Send cookies to the server
          <input type="file" accept=".txt,.json,text/plain,application/json" onChange={(e) => void upload(e)} />
        </label>
        {cookies ? (
          <p className={cookies.ok ? "muted" : "browser-refused"} role={cookies.ok ? "status" : "alert"}>
            {cookies.text}
          </p>
        ) : null}
        <p className="browser-note muted" role="note">
          Profiles and agent control of this tab are not available. An agent uses the headless browser of the server.
        </p>
      </div>
    </div>
  );
}
