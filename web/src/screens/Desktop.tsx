import { useEffect, useState, type ReactNode } from "react";
import type { Authed } from "../api";
import type { AppEnv } from "../App";
import { emptyMain, keyAction, mainTabs, modifierKeys, nextNeeding, sidebarRows, type Keys, type MainTab } from "../desktop";
import { parseRoute } from "../route";
import { sessionMeta, stateStyle } from "../sessions";
import type { Session, StreamClient, StreamSnapshot } from "../stream";
import { Brand } from "./Brand";
import { NewSession } from "./NewSession";
import { SessionScreen } from "./Session";
import { Connection, Limits, sessionHref, sessionTitle } from "./SessionList";

export type PaneProps = {
  session: Session;
  snapshot: StreamSnapshot;
  now: number;
  onRetry: () => void;
  client: StreamClient;
  api: Authed;
};

function Placeholder({ title }: { title: string }) {
  return (
    <div className="pane-placeholder">
      <p className="pane-title">{title}</p>
      <p className="muted">This tab is not available in this version of the app.</p>
    </div>
  );
}

export const panes: Record<MainTab, (props: PaneProps) => ReactNode> = {
  chat: (p) => <SessionScreen key={p.session.ID} id={p.session.ID} snapshot={p.snapshot} now={p.now} onRetry={p.onRetry} client={p.client} api={p.api} />,
  terminal: () => <Placeholder title="Terminal" />,
  review: () => <Placeholder title="Review" />,
  shell: () => <Placeholder title="Shell" />,
  nvim: () => <Placeholder title="nvim" />,
};

function Row({ session, current, shortcut, keys }: { session: Session; current: boolean; shortcut: number | null; keys: Keys }) {
  return (
    <li>
      <a
        className={"side-row state-" + (session.Ended ? "ended" : session.State) + (session.Unread ? " unread" : "")}
        href={sessionHref(session.ID)}
        aria-current={current ? "page" : undefined}
        aria-keyshortcuts={shortcut === null ? undefined : keys.aria + "+" + shortcut}
      >
        <span className="glyph" aria-hidden="true">
          {stateStyle(session.State).glyph}
        </span>
        <span className="side-text">
          <span className="name">{sessionTitle(session)}</span>
          <span className="meta">{sessionMeta(session)}</span>
        </span>
        {shortcut === null ? null : <kbd>{keys.label + shortcut}</kbd>}
      </a>
    </li>
  );
}

function Group({ title, sessions, selected, keys, numbered }: { title: string; sessions: Session[]; selected: string | null; keys: Keys; numbered: boolean }) {
  const id = "side-" + title.toLowerCase();
  return (
    <section className="side-group" aria-labelledby={id}>
      <h2 id={id}>
        <span>{title}</span>
        <span className="count" aria-hidden="true">
          {sessions.length}
        </span>
      </h2>
      <ul>
        {sessions.map((s, i) => (
          <Row key={s.ID} session={s} current={s.ID === selected} shortcut={numbered && i < 9 ? i + 1 : null} keys={keys} />
        ))}
      </ul>
    </section>
  );
}

function Sidebar({ env, snapshot, now, onRetry, selected, hash, keys }: { env: AppEnv; snapshot: StreamSnapshot; now: number; onRetry: () => void; selected: string | null; hash: string; keys: Keys }) {
  const rows = sidebarRows(snapshot.state?.sessions ?? []);
  const mark = (prefix: string) => (hash === prefix || hash.startsWith(prefix + "/") ? "page" : undefined);
  return (
    <nav className="sidebar" aria-label="Sidebar">
      <div className="side-head">
        <Brand host={env.host} />
        <a className="new-session" href="#/new" aria-keyshortcuts={keys.aria + "+N"}>
          New session
        </a>
      </div>
      <Connection snapshot={snapshot} now={now} onRetry={onRetry} />
      <div className="side-scroll">
        <Group title="Sessions" sessions={rows.live} selected={selected} keys={keys} numbered />
        {rows.ended.length > 0 ? <Group title="Ended" sessions={rows.ended} selected={selected} keys={keys} numbered={false} /> : null}
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

function Toolbar({ tab, hasSession, onTab }: { tab: MainTab; hasSession: boolean; onTab: (tab: MainTab) => void }) {
  return (
    <div className="toolbar">
      <div className="view-tabs" role="tablist" aria-label="Views">
        {mainTabs.map((t) => {
          const enabled = hasSession || t.needs === null;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
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
    </div>
  );
}

function Empty({ snapshot, live, keys }: { snapshot: StreamSnapshot; live: number; keys: Keys }) {
  const empty = emptyMain(snapshot.state, live, keys.label);
  return (
    <div className="main-empty">
      <p className="pane-title">{empty.title}</p>
      {empty.detail ? <p className="muted">{empty.detail}</p> : null}
      {empty.offersNew ? (
        <a className="new-session" href="#/new">
          New session
        </a>
      ) : null}
    </div>
  );
}

function Sheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
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
      <div className="sheet" role="dialog" aria-modal="true" aria-label="New session">
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
  other: ReactNode;
};

export function Desktop({ env, token, hash, go, snapshot, now, onRetry, client, api, other }: DesktopProps) {
  const [tab, setTab] = useState<MainTab>("chat");
  const keys = modifierKeys(env.userAgent);
  const route = parseRoute(hash);
  const selectedId = route.screen === "session" ? route.id : null;
  const sessions = snapshot.state?.sessions ?? [];
  const rows = sidebarRows(sessions);
  const session = sessions.find((s) => s.ID === selectedId) ?? null;
  const routeTab = route.screen === "session" ? route.tab : undefined;

  useEffect(() => {
    if (routeTab) {
      setTab(routeTab);
    }
  }, [routeTab, selectedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = keyAction(e);
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
      const next = nextNeeding(rows.live, selectedId);
      if (next) {
        go(sessionHref(next.ID));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows.live, selectedId, go]);

  let main: ReactNode;
  if (other) {
    main = <div className="main-other">{other}</div>;
  } else if (session || (tab === "terminal" && route.screen !== "session")) {
    main = (
      <>
        <Toolbar tab={tab} hasSession={session !== null} onTab={setTab} />
        <section className={"pane pane-" + tab} role="tabpanel" id={"pane-" + tab} aria-labelledby={"tab-" + tab}>
          {session ? panes[tab]({ session, snapshot, now, onRetry, client, api }) : <Placeholder title="Terminal" />}
        </section>
      </>
    );
  } else {
    main = (
      <>
        <Toolbar tab={tab} hasSession={false} onTab={setTab} />
        <Empty snapshot={snapshot} live={rows.live.length} keys={keys} />
      </>
    );
  }

  return (
    <div className="desktop">
      <Sidebar env={env} snapshot={snapshot} now={now} onRetry={onRetry} selected={selectedId} hash={hash} keys={keys} />
      <main className="main-column">{main}</main>
      {route.screen === "new" ? (
        <Sheet onClose={() => go("#/")}>
          <NewSession env={env} token={token} />
        </Sheet>
      ) : null}
    </div>
  );
}
