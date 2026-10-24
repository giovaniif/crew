import { machineName } from "../envs";
import { MachineContext, useMachine } from "./Machine";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { listApprovals, resumeSession, type Authed } from "../api";
import type { AppEnv } from "../App";
import { emptyMain, keyAction, mainTabs, modifierKeys, nextNeeding, sessionPlace, sidebarRows, stateDot, type Keys, type MainTab } from "../desktop";
import { navItem, parseRoute } from "../route";
import type { PullRequest, Session, StreamClient, StreamSnapshot, Worktree } from "../stream";
import { timeInState } from "../sessions";
import { Segmented } from "../ui";
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

function prOf(session: Session, worktrees: Worktree[]): PullRequest | null {
  const ids = session.WorktreeIDs ?? [];
  return worktrees.find((w) => ids.includes(w.ID) && w.PR)?.PR ?? null;
}

function TableRow({ session, worktrees, now, shortcut, keys, onMenu }: { session: Session; worktrees: Worktree[]; now: number; shortcut: number | null; keys: Keys; onMenu: OnMenu }) {
  const pr = prOf(session, worktrees);
  const sub = session.Mate ? session.Mate.Name : session.Ended ? "ended" : String(session.State);
  const passed = pr?.Checks === "pass" || pr?.Checks === "success";
  return (
    <li>
      <a
        className={"tl-row state-" + (session.Ended ? "ended" : session.State) + (session.Unread ? " unread" : "")}
        href={sessionHref(session.ID)}
        aria-keyshortcuts={shortcut === null ? undefined : keys.aria + "+" + shortcut}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(session.ID, e.clientX, e.clientY);
        }}
      >
        <span className={"dot " + stateDot(session)} aria-hidden="true" />
        <span className="tl-name" data-col="session">
          <span className="nm">{sessionTitle(session)}</span>
          <span className="sub">{sub}</span>
        </span>
        <span data-col="harness">
          <span className="hz">{session.Harness + " · " + (session.Model || session.Effort || "default")}</span>
        </span>
        <span className="dim" data-col="repo">
          {session.where || "—"}
        </span>
        <span data-col="pr">{pr ? <span className={"pill" + (passed ? " ok" : "")}>{"#" + pr.Number + (passed ? " ✓" : "")}</span> : "—"}</span>
        <span className="muted tl-last" data-col="last">
          {timeInState(session.since, now) || "—"}
        </span>
      </a>
    </li>
  );
}

function shortcutOf(live: Session[], s: Session): number | null {
  const i = live.indexOf(s);
  return i >= 0 && i < 9 ? i + 1 : null;
}

function SessionTable({ title, label, sessions, worktrees, now, keys, onMenu, shortcuts }: { title?: string; label: string; sessions: Session[]; worktrees: Worktree[]; now: number; keys: Keys; onMenu: OnMenu; shortcuts: Session[] }) {
  if (sessions.length === 0) {
    return null;
  }
  return (
    <section aria-label={label} className="tl-group">
      {title ? <div className="section-title">{title}</div> : null}
      <ul>
        {sessions.map((s) => (
          <TableRow key={s.ID} session={s} worktrees={worktrees} now={now} shortcut={shortcutOf(shortcuts, s)} keys={keys} onMenu={onMenu} />
        ))}
      </ul>
    </section>
  );
}

type SidebarProps = { env: AppEnv; snapshot: StreamSnapshot; now: number; onRetry: () => void; hash: string; keys: Keys; chip: ReactNode; approvals: number };

type NavItem = { href: string; icon: string; label: string; on: boolean; meta?: ReactNode };

function NavLink({ item }: { item: NavItem }) {
  return (
    <li>
      <a className={"row side-nav" + (item.on ? " on" : "")} href={item.href} aria-current={item.on ? "page" : undefined}>
        <span className="ico" aria-hidden="true">
          {item.icon}
        </span>
        <span className="nm">{item.label}</span>
        {item.meta}
      </a>
    </li>
  );
}

function Sidebar({ env, snapshot, now, onRetry, hash, keys, chip, approvals }: SidebarProps) {
  const active = navItem(hash);
  const mates = snapshot.state?.mates?.mates.length ?? 0;
  const live = sidebarRows(snapshot.state?.sessions ?? []).live.length;
  const count = (n: number) => (n > 0 ? <span className="meta">{n}</span> : null);
  const items: NavItem[] = [
    { href: "#/mates", icon: "◉", label: "Mates", on: active === "mates", meta: count(mates) },
    { href: "#/sessions", icon: "▤", label: "Sessions", on: active === "sessions", meta: count(live) },
    { href: "#/approvals", icon: "✓", label: "Approvals", on: active === "approvals", meta: approvals > 0 ? <span className="pill bad">{approvals}</span> : null },
    { href: "#/automations", icon: "↻", label: "Automations", on: active === "automations" },
    { href: "#/envs", icon: "⌂", label: "Environments", on: active === "envs" },
    { href: "#/disk", icon: "▥", label: "Disk", on: active === "disk" },
  ];
  return (
    <nav className="sidebar nav" aria-label="Sidebar">
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
      <a className="ui btn newbtn" href="#/mates/new">
        + New mate
      </a>
      <ul className="side-sec">
        {items.map((i) => (
          <NavLink key={i.href} item={i} />
        ))}
      </ul>
      <div className="side-scroll" />
      <div className="side-foot">
        {snapshot.state?.mates?.stopped ? (
          <p className="mates-stopped" role="status">
            All mates are stopped
          </p>
        ) : null}
        <ul className="side-sec">
          <NavLink item={{ href: "#/settings", icon: "⚙", label: "Settings", on: active === "settings" }} />
        </ul>
        <Limits snapshot={snapshot} now={now} />
      </div>
    </nav>
  );
}

function SessionsPage({ snapshot, now, keys, onMenu }: { snapshot: StreamSnapshot; now: number; keys: Keys; onMenu: OnMenu }) {
  const [show, setShow] = useState<"active" | "ended">("active");
  const { live, ended } = sidebarRows(snapshot.state?.sessions ?? []);
  const worktrees = snapshot.state?.worktrees ?? [];
  const rows = show === "active" ? live : ended;
  const own = rows.filter((s) => !s.Mate);
  const mates = rows.filter((s) => s.Mate);
  const name = show === "active" ? "Active sessions" : "Ended sessions";
  return (
    <>
      <div className="session-bar">
        <h1 className="title">Sessions</h1>
        <span className="sub">Agents you run on this computer, one worktree each</span>
        <span className="spacer" />
        <Segmented
          label="Show"
          value={show}
          onChange={setShow}
          options={[
            { value: "active", label: "Active" },
            { value: "ended", label: "Ended" },
          ]}
        />
        <a className="ui btn primary sm" href="#/new">
          New session
        </a>
      </div>
      <div className="sessions-page sess">
        {show === "active" && live.length === 0 ? <Empty snapshot={snapshot} live={0} keys={keys} /> : null}
        {rows.length > 0 ? (
          <div className="tl-row h" aria-hidden="true">
            <span />
            <span>Session</span>
            <span>Harness</span>
            <span>Repo</span>
            <span>PR</span>
            <span>Last</span>
          </div>
        ) : null}
        {show === "ended" && rows.length === 0 ? <p className="muted tl-none">No ended sessions.</p> : null}
        <SessionTable label={name} sessions={own} worktrees={worktrees} now={now} keys={keys} onMenu={onMenu} shortcuts={show === "active" ? live : []} />
        <SessionTable title="STARTED BY MATES" label="Started by mates" sessions={mates} worktrees={worktrees} now={now} keys={keys} onMenu={onMenu} shortcuts={show === "active" ? live : []} />
      </div>
    </>
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

function Sheet({ children, onClose, label }: { children: ReactNode; onClose: () => void; label: string }) {
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

function usePendingApprovals(api: Authed, hash: string): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let on = true;
    listApprovals(api)
      .then((list) => on && setN(list.filter((a) => a.State === "pending").length))
      .catch(() => undefined);
    return () => {
      on = false;
    };
  }, [api, hash]);
  return n;
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
  const outerMachine = useMachine();
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

  const onMenu: OnMenu = (id, x, y) => setMenu((m) => ({ id, x, y, n: (m?.n ?? 0) + 1 }));
  const approvals = usePendingApprovals(api, hash);
  let main: ReactNode;
  if (route.screen === "new") {
    main = (
      <div className="main-home">
        <NewSession env={env} token={token} home />
      </div>
    );
  } else if (other) {
    main = <div className="main-other">{other}</div>;
  } else if (route.screen === "list") {
    main = <SessionsPage snapshot={snapshot} now={now} keys={keys} onMenu={onMenu} />;
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
          <TerminalPane store={terminals} session={session} kind="agent" onBack={back} onResume={() => resumeSession(api, session.ID)} />
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

  return (
    <MachineContext.Provider value={listing ? machineName(listing, env.host) : outerMachine}>
      <div className="desktop">
        <Sidebar
          env={env}
          snapshot={snapshot}
          now={now}
          onRetry={onRetry}
          hash={hash}
          keys={keys}
          approvals={approvals}
          chip={servers ? <ServerChip servers={servers} listing={listing} go={go} /> : null}
        />
        {menu && menuSession ? <SessionCommands key={"menu-" + menu.id} api={api} session={menuSession} storage={env.storage} openAt={menu} /> : null}
        <main className="main-column">{main}</main>
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
              storage={env.storage}
              mac={/Macintosh/.test(env.userAgent)}
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
    </MachineContext.Provider>
  );
}
