import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Authed } from "../api";
import type { AppEnv } from "../App";
import { emptyMain, keyAction, mainTabs, modifierKeys, nextNeeding, sessionPlace, sidebarGroups, sidebarRows, stateDot, type Keys, type MainTab } from "../desktop";
import { parseRoute } from "../route";
import type { Session, StreamClient, StreamSnapshot } from "../stream";
import type { Servers } from "../servers";
import type { DesktopBridge } from "../desktopBridge";
import { FirstRun } from "./FirstRun";
import { ServerChip, useServerListing } from "./Servers";
import { BrowserPane, type BrowserStore } from "./Browser";
import { NewSession } from "./NewSession";
import { ReviewPane } from "./Review";
import { SessionScreen } from "./Session";
import { TerminalPane } from "./Terminal";
import type { TerminalStore } from "../terminal";
import { SessionCommands, type MenuPoint } from "./SessionCommands";
import { Connection, Limits, sessionHref, sessionTitle } from "./SessionList";

export type PaneProps = {
  session: Session;
  snapshot: StreamSnapshot;
  now: number;
  onRetry: () => void;
  client: StreamClient;
  api: Authed;
  terminals: TerminalStore | null;
  host: string;
  browsers: BrowserStore;
  desktop?: DesktopBridge;
  onBrowser?: () => void;
};

export const panes: Record<MainTab, (props: PaneProps) => ReactNode> = {
  chat: (p) => <SessionScreen key={p.session.ID} id={p.session.ID} snapshot={p.snapshot} now={p.now} onRetry={p.onRetry} client={p.client} api={p.api} onBrowser={p.onBrowser} inBar />,
  review: (p) => <ReviewPane key={p.session.ID} session={p.session.ID} sessionState={p.session.State} api={p.api} />,
};

type OnMenu = (id: string, x: number, y: number) => void;

function Row({ session, current, shortcut, keys, onMenu }: { session: Session; current: boolean; shortcut: number | null; keys: Keys; onMenu: OnMenu }) {
  return (
    <li>
      <a
        className={"row side-row state-" + (session.Ended ? "ended" : session.State) + (session.Unread ? " unread" : "") + (current ? " on" : "")}
        href={sessionHref(session.ID)}
        aria-current={current ? "page" : undefined}
        aria-keyshortcuts={shortcut === null ? undefined : keys.aria + "+" + shortcut}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(session.ID, e.clientX, e.clientY);
        }}
      >
        <span className={"dot " + stateDot(session)} aria-hidden="true" />
        <span className="nm">{sessionTitle(session)}</span>
        {session.Muted ? <span className="badge muted-badge">muted</span> : null}
        {shortcut === null ? null : <kbd className={keys.mac ? undefined : "on-demand"}>{keys.label + shortcut}</kbd>}
        <span className="meta">{sessionPlace(session.where ?? "").repo}</span>
      </a>
    </li>
  );
}

function Group({ title, sessions, selected, keys, first, onMenu }: { title: string; sessions: Session[]; selected: string | null; keys: Keys; first: number; onMenu: OnMenu }) {
  if (sessions.length === 0) {
    return null;
  }
  const id = "side-" + title.toLowerCase().replace(/ /g, "-");
  return (
    <section className="side-group" aria-labelledby={id}>
      <h2 id={id} className="side-label">
        <span>{title}</span>
        <span className="count" aria-hidden="true">
          {sessions.length}
        </span>
      </h2>
      <ul>
        {sessions.map((s, i) => {
          const n = first + i;
          return <Row key={s.ID} session={s} current={s.ID === selected} shortcut={!s.Ended && n < 9 ? n + 1 : null} keys={keys} onMenu={onMenu} />;
        })}
      </ul>
    </section>
  );
}

type SidebarProps = { env: AppEnv; snapshot: StreamSnapshot; now: number; onRetry: () => void; selected: string | null; hash: string; keys: Keys; onMenu: OnMenu; chip: ReactNode };

function Sidebar({ env, snapshot, now, onRetry, selected, hash, keys, onMenu, chip }: SidebarProps) {
  const groups = sidebarGroups(snapshot.state?.sessions ?? []);
  const mark = (prefix: string) => (hash === prefix || hash.startsWith(prefix + "/") ? "page" : undefined);
  return (
    <nav className="sidebar" aria-label="Sidebar">
      <div className="side-head">
        <span className="brand" title={env.host}>
          crew
        </span>
        <a className={"ui icon-btn" + (hash === "#/new" ? " on" : "")} href="#/new" aria-label="New session" title={"New session  " + keys.label + "N"} aria-keyshortcuts={keys.aria + "+N"}>
          +
        </a>
      </div>
      {chip ? <div className="side-chip">{chip}</div> : null}
      <Connection snapshot={snapshot} now={now} onRetry={onRetry} fix={env.desktopFix} />
      <div className="side-scroll">
        <Group title="Needs you" sessions={groups.needs} selected={selected} keys={keys} first={0} onMenu={onMenu} />
        <Group title="Running" sessions={groups.running} selected={selected} keys={keys} first={groups.needs.length} onMenu={onMenu} />
        <Group title="Done" sessions={groups.done} selected={selected} keys={keys} first={groups.needs.length + groups.running.length} onMenu={onMenu} />
      </div>
      <div className="side-foot">
        {snapshot.state?.mates?.stopped ? (
          <p className="mates-stopped" role="status">
            All mates are stopped
          </p>
        ) : null}
        <ul className="side-links">
          <li>
            <a href="#/mates" aria-current={mark("#/mates")}>
              Mates
            </a>
          </li>
          <li>
            <a href="#/approvals" aria-current={mark("#/approvals")}>
              Approvals
            </a>
          </li>
          <li>
            <a href="#/automations" aria-current={mark("#/automations")}>
              Automations
            </a>
          </li>
          <li>
            <a href="#/disk" aria-current={mark("#/disk")}>
              Disk
            </a>
          </li>
          <li>
            <a href="#/settings" aria-current={mark("#/settings")}>
              Settings
            </a>
          </li>
        </ul>
        <Limits snapshot={snapshot} now={now} />
      </div>
    </nav>
  );
}

function Tabs({ tab, hasSession, onTab }: { tab: MainTab; hasSession: boolean; onTab: (tab: MainTab) => void }) {
  return (
    <div className="view-tabs" role="tablist" aria-label="Views">
      {mainTabs.map((t) => {
        const enabled = hasSession || t.needs === null;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            className={"tab" + (t.id === tab ? " on" : "")}
            id={"tab-" + t.id}
            aria-controls={"pane-" + t.id}
            aria-selected={t.id === tab}
            disabled={!enabled}
            title={enabled ? undefined : (t.needs ?? undefined)}
            onClick={() => onTab(t.id)}
          >
            {t.title}
          </button>
        );
      })}
    </div>
  );
}

type ToolbarProps = { session: Session | null; tab: MainTab; onTab: (tab: MainTab) => void; shell?: boolean; onShell?: () => void; children?: ReactNode };

function Toolbar({ session, tab, onTab, shell, onShell, children }: ToolbarProps) {
  const sub = session ? sessionPlace(session.where ?? "").sub : "";
  return (
    <div className="session-bar" role="toolbar" aria-label="Session bar">
      {session ? <span className="title">{sessionTitle(session)}</span> : null}
      {sub ? <span className="sub">{sub}</span> : null}
      <span className="spacer" />
      <Tabs tab={tab} hasSession={session !== null} onTab={onTab} />
      {onShell ? (
        <button type="button" className={"ui icon-btn" + (shell ? " on" : "")} aria-label="Shell" title="Shell  ⌃`" aria-pressed={shell ? "true" : "false"} onClick={onShell}>
          ›_
        </button>
      ) : null}
      {children}
    </div>
  );
}

function ViewOverlay({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  return (
    <section className="view-overlay" role="region" aria-label={label}>
      <div className="drawer-bar">
        <span className="drawer-title">{label}</span>
        <span className="spacer" />
        <button type="button" className="ui icon-btn" aria-label={"Close " + label.toLowerCase()} onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="view-body">{children}</div>
    </section>
  );
}

function ShellDrawer({ session, terminals, onClose }: { session: Session; terminals: TerminalStore | null; onClose: () => void }) {
  return (
    <section className="drawer" role="region" aria-label="Shell">
      <div className="drawer-bar">
        <span className="drawer-title">Shell</span>
        <span className="drawer-path">{session.Dir || sessionPlace(session.where ?? "").sub}</span>
        <span className="spacer" />
        <button type="button" className="ui icon-btn" aria-label="Close shell" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="drawer-body">
        <TerminalPane store={terminals} session={session} kind="shell" />
      </div>
    </section>
  );
}

function BrowserPanel({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <aside className="browser-panel" aria-label="Browser">
      <button type="button" className="ui icon-btn browser-close" aria-label="Close browser" onClick={onClose}>
        ✕
      </button>
      {children}
    </aside>
  );
}

function Empty({ snapshot, live, keys }: { snapshot: StreamSnapshot; live: number; keys: Keys }) {
  const empty = emptyMain(snapshot.state, live, keys.label);
  return (
    <div className="main-empty">
      <p className="pane-title">{empty.title}</p>
      {empty.detail ? <p className="muted">{empty.detail}</p> : null}
      {empty.offersNew ? (
        <a className="ui btn primary" href="#/new">
          New session
        </a>
      ) : null}
    </div>
  );
}

function Sheet({ children, onClose, label = "New session" }: { children: ReactNode; onClose: () => void; label?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop">
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

export type DesktopProps = {
  env: AppEnv;
  token: string;
  hash: string;
  go: (hash: string) => void;
  snapshot: StreamSnapshot;
  now: number;
  onRetry: () => void;
  client: StreamClient;
  api: Authed;
  terminals?: TerminalStore | null;
  other: ReactNode;
  servers?: Servers;
};

export function Desktop({ env, token, hash, go, snapshot, now, onRetry, client, api, terminals = null, other, servers }: DesktopProps) {
  const [tab, setTab] = useState<MainTab>("chat");
  const browsers = useRef<BrowserStore>(new Map());
  const [menu, setMenu] = useState<(MenuPoint & { id: string }) | null>(null);
  const [listing] = useServerListing(servers);
  const [firstRun, setFirstRun] = useState(false);
  useEffect(() => {
    if (listing?.first_run) {
      setFirstRun(true);
    }
  }, [listing]);
  const keys = modifierKeys(env.userAgent);
  const route = parseRoute(hash);
  const selectedId = route.screen === "session" ? route.id : null;
  const sessions = snapshot.state?.sessions ?? [];
  const rows = sidebarRows(sessions);
  const session = sessions.find((s) => s.ID === selectedId) ?? null;
  const view = route.screen === "session" ? route.view : undefined;
  const [shell, setShell] = useState(false);
  const [browser, setBrowser] = useState(false);
  const autoBrowsed = useRef(new Set<string>());

  useEffect(() => {
    setBrowser(view === "browser");
    if (view === "shell") {
      setShell(true);
    }
  }, [view, selectedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = keyAction(e, keys.mac);
      if (!action) {
        return;
      }
      if (action.kind === "select") {
        const target = rows.live[action.index];
        if (!target) {
          return;
        }
        e.preventDefault();
        go(sessionHref(target.ID));
        return;
      }
      e.preventDefault();
      if (action.kind === "new") {
        go("#/new");
        return;
      }
      if (action.kind === "shell") {
        setShell((v) => !v);
        return;
      }
      if (action.kind === "editor") {
        if (selectedId) {
          go(sessionHref(selectedId) + "/editor");
        }
        return;
      }
      const next = nextNeeding(rows.live, selectedId);
      if (next) {
        go(sessionHref(next.ID));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows.live, selectedId, go, keys.mac]);

  let main: ReactNode;
  if (other) {
    main = <div className="main-other">{other}</div>;
  } else if (session) {
    const back = () => go(sessionHref(session.ID));
    const onBrowser = () => {
      if (!autoBrowsed.current.has(session.ID)) {
        autoBrowsed.current.add(session.ID);
        setBrowser(true);
      }
    };
    const overlay = view === "editor" || view === "agent";
    let body: ReactNode;
    if (view === "editor") {
      body = (
        <ViewOverlay label="Editor" onClose={back}>
          <TerminalPane store={terminals} session={session} kind="nvim" />
        </ViewOverlay>
      );
    } else if (view === "agent") {
      body = (
        <ViewOverlay label="Agent screen" onClose={back}>
          <TerminalPane store={terminals} session={session} kind="agent" onBack={back} />
        </ViewOverlay>
      );
    } else {
      body = (
        <section className={"pane pane-" + tab} role="tabpanel" id={"pane-" + tab} aria-labelledby={"tab-" + tab}>
          {panes[tab]({ session, snapshot, now, onRetry, client, api, terminals, host: env.host, browsers: browsers.current, desktop: env.desktop, onBrowser })}
        </section>
      );
    }
    const onTab = (t: MainTab) => {
      setTab(t);
      if (overlay) {
        back();
      }
    };
    main = (
      <>
        <Toolbar session={session} tab={tab} onTab={onTab} shell={shell} onShell={() => setShell((v) => !v)}>
          <SessionCommands key={session.ID} api={api} session={session} storage={env.storage} button />
        </Toolbar>
        <div className={"split" + (browser ? " with-browser" : "")}>
          <div className="split-main">
            {body}
            {shell ? <ShellDrawer session={session} terminals={terminals} onClose={() => setShell(false)} /> : null}
          </div>
          {browser ? (
            <BrowserPanel onClose={() => setBrowser(false)}>
              <BrowserPane key={session.ID} session={session.ID} worktrees={snapshot.state?.worktrees ?? []} host={env.host} store={browsers.current} api={api} desktop={env.desktop} />
            </BrowserPanel>
          ) : null}
        </div>
      </>
    );
  } else {
    main = (
      <>
        <Toolbar session={null} tab={tab} onTab={setTab} />
        <Empty snapshot={snapshot} live={rows.live.length} keys={keys} />
      </>
    );
  }

  const menuSession = menu ? sessions.find((s) => s.ID === menu.id) : undefined;
  const onMenu: OnMenu = (id, x, y) => setMenu((m) => ({ id, x, y, n: (m?.n ?? 0) + 1 }));

  return (
    <div className="desktop">
      <Sidebar
        env={env}
        snapshot={snapshot}
        now={now}
        onRetry={onRetry}
        selected={selectedId}
        hash={hash}
        keys={keys}
        onMenu={onMenu}
        chip={servers ? <ServerChip servers={servers} listing={listing} go={go} /> : null}
      />
      {menu && menuSession ? <SessionCommands key={"menu-" + menu.id} api={api} session={menuSession} storage={env.storage} openAt={menu} /> : null}
      <main className="main-column">{main}</main>
      {route.screen === "new" ? (
        <Sheet onClose={() => go("#/")}>
          <NewSession env={env} token={token} />
        </Sheet>
      ) : null}
      {servers && (firstRun || hash === "#/servers/add") ? (
        <Sheet
          label="Add a server"
          onClose={() => {
            setFirstRun(false);
            if (hash === "#/servers/add") {
              go("#/servers");
            }
          }}
        >
          <FirstRun
            servers={servers}
            welcome={firstRun}
            onClose={() => {
              setFirstRun(false);
              if (hash === "#/servers/add") {
                go("#/servers");
              }
            }}
          />
        </Sheet>
      ) : null}
    </div>
  );
}
