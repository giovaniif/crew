import { machineName } from "./envs";
import { MachineContext } from "./screens/Machine";
import { HubContext } from "./hub";
import { desktopMachines, type Machines } from "./machines";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { sessionPane, tokenRefused, unpairDevice, type Fetch } from "./api";
import { clearAuth, loadAuth, saveAuth, type Auth, type KeyValue } from "./auth";
import { pairCodeFromHash } from "./display";
import { useDesktopAttention, type DesktopBridge } from "./desktopBridge";
import { disablePush, noPush, type PushEnv } from "./push";
import { modifierKeys } from "./desktop";
import { parseRoute, phoneTab } from "./route";
import { Approvals } from "./screens/Approvals";
import { Automations } from "./screens/Automations";
import { automationRoute } from "./matepage";
import { Desktop } from "./screens/Desktop";
import { Disk } from "./screens/Disk";
import { Environments } from "./screens/Environments";
import { MatePage, NewMate } from "./screens/Mates";
import { MatesHome } from "./screens/MatesHome";
import { FirstMate, firstMateSkipped } from "./screens/FirstMate";
import { More } from "./screens/More";
import { Install } from "./screens/Install";
import { NewSession } from "./screens/NewSession";
import { Pair } from "./screens/Pair";
import { SessionScreen } from "./screens/Session";
import { SessionList } from "./screens/SessionList";
import { FirstRun } from "./screens/FirstRun";
import { Settings, type UpdateCheck } from "./screens/Settings";
import { PhoneSession } from "./screens/PhoneSession";
import { ReviewPane } from "./screens/Review";
import { Servers } from "./servers";
import { useStream, useStreamClient, type OpenSocket, type StreamClient } from "./stream";
import { TerminalStore, type TerminalEnv } from "./terminal";

export type AppEnv = {
  fetch: Fetch;
  storage: KeyValue;
  installed: boolean;
  hash: string;
  host: string;
  userAgent: string;
  openStream: OpenSocket;
  retryDelay?: (attempt: number) => number;
  now: () => number;
  onHashChange: (listener: (hash: string) => void) => () => void;
  push?: PushEnv;
  visibility?: PageVisibility;
  wide?: Width;
  desktopAuth?: Auth | null;
  desktopFix?: () => Promise<void>;
  terminal?: TerminalEnv;
  desktop?: DesktopBridge;
  connectUrl?: string;
};

export type Width = {
  matches: () => boolean;
  onChange: (listener: () => void) => () => void;
};

const narrow: Width = { matches: () => false, onChange: () => () => {} };

function useWide(width: Width = narrow): boolean {
  return useSyncExternalStore(width.onChange, width.matches);
}

export type PageVisibility = {
  visible: () => boolean;
  onChange: (listener: () => void) => () => void;
};

type Tab = "mates" | "sessions" | "approvals" | "more";

const tabItems: { tab: Tab; href: string; icon: string; label: string }[] = [
  { tab: "mates", href: "#/mates", icon: "◉", label: "Mates" },
  { tab: "sessions", href: "#/sessions", icon: "▤", label: "Sessions" },
  { tab: "approvals", href: "#/approvals", icon: "✓", label: "Approvals" },
  { tab: "more", href: "#/more", icon: "⋯", label: "More" },
];

function Tabs({ current }: { current: Tab }) {
  return (
    <nav className="tabs" aria-label="Screens">
      {tabItems.map((t) => (
        <a key={t.tab} href={t.href} aria-current={current === t.tab ? "page" : undefined}>
          <b aria-hidden="true">{t.icon}</b>
          {t.label}
        </a>
      ))}
    </nav>
  );
}

function useNow(now: () => number, every: number): number {
  const [value, setValue] = useState(now);
  useEffect(() => {
    setValue(now());
    const timer = setInterval(() => setValue(now()), every);
    return () => clearInterval(timer);
  }, [now, every]);
  return value;
}

function useTerminals(env: TerminalEnv | undefined, api: { fetch: Fetch; token: string }, mac: boolean): TerminalStore | null {
  const store = useMemo(() => (env ? new TerminalStore(env, api.token, (session, kind) => sessionPane(api, session, kind), mac) : null), [env, api, mac]);
  useEffect(() => () => store?.dispose(), [store]);
  return store;
}

type ConnectedProps = { env: AppEnv; auth: Auth; onUnauthorized: () => void; onSignOut: () => Promise<void> };

function Connected({ env, auth, onUnauthorized, onSignOut }: ConnectedProps) {
  const { onHashChange, fetch, visibility } = env;
  const confirmRefused = useCallback(() => tokenRefused(fetch, auth.token), [fetch, auth.token]);
  const client = useStreamClient({
    open: env.openStream,
    token: auth.token,
    retryDelay: env.retryDelay,
    now: env.now,
    visible: visibility?.visible,
    confirmRefused,
  });
  const snapshot = useStream(client);
  const [hash, setHash] = useState(env.hash);
  const now = useNow(env.now, snapshot.status === "offline" ? 1000 : 30000);
  const api = useMemo(() => ({ fetch, token: auth.token }), [fetch, auth.token]);
  const servers = useMemo(() => (env.desktop ? new Servers(env.desktop) : undefined), [env.desktop]);
  const terminals = useTerminals(env.terminal, api, modifierKeys(env.userAgent).mac);
  const sessionIds = snapshot.state ? snapshot.state.sessions.map((s) => s.ID).join("\n") : null;

  useEffect(() => {
    if (terminals && sessionIds !== null) {
      terminals.prune(sessionIds ? sessionIds.split("\n") : []);
    }
  }, [terminals, sessionIds]);

  useEffect(() => onHashChange(setHash), [onHashChange]);
  useDesktopAttention(env.desktop, client, snapshot, hash, env.storage, visibility, now);

  useEffect(() => visibility?.onChange(() => client.visibilityChanged()), [visibility, client]);

  useEffect(() => {
    if (snapshot.status === "unauthorized") {
      onUnauthorized();
    }
  }, [snapshot.status, onUnauthorized]);

  const go = useCallback((next: string) => {
    window.location.hash = next;
    setHash(next);
  }, []);
  const wide = useWide(env.wide);
  const route = parseRoute(hash);
  const retry = () => client.retryNow();
  const other = otherScreen(hash, { env, auth, api, now, snapshot, onSignOut, go, servers, wide, client });
  if (wide) {
    return (
      <Desktop
        servers={servers}
        env={env}
        token={auth.token}
        hash={hash}
        go={go}
        snapshot={snapshot}
        now={now}
        onRetry={retry}
        client={client}
        api={api}
        terminals={terminals}
        other={other?.screen ?? null}
      />
    );
  }
  if (route.screen === "new") {
    return <NewSession env={env} token={auth.token} />;
  }
  if (hash === "#/servers/add" && servers) {
    return (
      <main className="screen">
        <FirstRun servers={servers} welcome={false} storage={env.storage} mac={/Macintosh/.test(env.userAgent)} onClose={() => go("#/servers")} />
      </main>
    );
  }
  if (route.screen === "session") {
    const phoneSession = snapshot.state?.sessions.find((s) => s.ID === route.id) ?? null;
    return (
      <PhoneSession
        key={route.id}
        session={phoneSession}
        terminals={terminals}
        review={phoneSession ? <ReviewPane session={phoneSession.ID} sessionState={phoneSession.State} api={api} /> : null}
      >
        <SessionScreen key={route.id} id={route.id} snapshot={snapshot} now={now} onRetry={retry} client={client} api={api} storage={env.storage} />
      </PhoneSession>
    );
  }
  if (other) {
    return (
      <>
        {other.screen}
        <Tabs current={phoneTab(hash)} />
      </>
    );
  }
  return (
    <>
      {snapshot.state?.mates?.stopped && (
        <a className="mates-stopped" role="status" href="#/mates">
          All mates are stopped
        </a>
      )}
      <SessionList host={env.host} snapshot={snapshot} now={now} onRetry={retry} />
      <Tabs current={phoneTab(hash)} />
    </>
  );
}

type OtherInputs = {
  env: AppEnv;
  auth: Auth;
  api: { fetch: Fetch; token: string };
  now: number;
  snapshot: ReturnType<typeof useStream>;
  onSignOut: () => Promise<void>;
  go: (hash: string) => void;
  servers?: Servers;
  wide: boolean;
  client: StreamClient;
};

function otherScreen(hash: string, { env, auth, api, now, snapshot, onSignOut, go, servers, wide, client }: OtherInputs): { screen: ReactNode; tab: Tab } | null {
  if (hash === "#/disk") {
    return { screen: <Disk api={api} state={snapshot.state} now={now} go={go} />, tab: "more" };
  }
  if (hash === "#/automations") {
    return { screen: <Automations api={api} now={now} />, tab: "more" };
  }
  const auto = automationRoute(hash);
  if (auto.creating) {
    return { screen: <Automations key={hash} api={api} now={now} forMate={auto.mate} />, tab: "more" };
  }
  if (hash === "#/envs" || hash.startsWith("#/envs/")) {
    return { screen: <Environments api={api} route={hash === "#/envs" ? "" : hash.slice("#/envs/".length)} wide={wide} desktop={env.desktop} />, tab: "more" };
  }
  if (hash === "#/more") {
    return { screen: <More />, tab: "more" };
  }
  if (hash.startsWith("#/mates/")) {
    const name = hash.slice("#/mates/".length);
    const repos = [...new Set((snapshot.state?.workspaces ?? []).flatMap((w) => (w.Repos ?? []).map((r) => r.Name)))];
    return {
      screen:
        name === "new" ? (
          <NewMate api={api} repos={repos} />
        ) : (
          <MatePage key={name.split("/")[0]} api={api} hash={hash} board={snapshot.state?.mates} snapshot={snapshot} client={client} wide={wide} />
        ),
      tab: "mates",
    };
  }
  if (hash === "#/approvals") {
    return { screen: <Approvals api={api} now={now} visibility={env.visibility} />, tab: "approvals" };
  }
  if (hash === "#/settings" || (hash === "#/servers" && servers)) {
    return {
      screen: (
        <>
          <Settings key={hash}
            auth={auth}
            host={env.host}
            installed={env.installed}
            storage={env.storage}
            fetch={env.fetch}
            push={env.push ?? noPush}
            onSignOut={onSignOut}
            connectUrl={env.connectUrl}
            userAgent={env.userAgent}
            desktop={!!env.desktop}
            local={!!env.desktopAuth}
            servers={servers}
            initial={hash === "#/servers" ? "servers" : undefined}
            checkUpdate={env.desktop ? () => env.desktop!.invoke("crew_check_update") as Promise<UpdateCheck> : undefined}
          />
        </>
      ),
      tab: "more",
    };
  }
  if (parseRoute(hash).screen === "home") {
    const board = snapshot.state?.mates;
    if (board && board.mates.length === 0 && !firstMateSkipped(env.storage)) {
      return { screen: <FirstMate api={api} storage={env.storage} wide={wide} />, tab: "mates" };
    }
    return { screen: <MatesHome api={api} now={now} board={board} wide={wide} />, tab: "mates" };
  }
  return null;
}

const refusedNotice =
  "This device was removed from crew, or the server rejected its login. Pair it again with a new code from crew remote pair.";

const hubCache = new WeakMap<DesktopBridge, Machines>();

function hubMachines(desktop: DesktopBridge | undefined): Machines | null {
  if (!desktop) {
    return null;
  }
  const known = hubCache.get(desktop) ?? desktopMachines(desktop);
  hubCache.set(desktop, known);
  return known;
}

export function App({ env }: { env: AppEnv }) {
  return (
    <MachineContext.Provider value={machineName(null, env.host)}>
      <HubContext.Provider value={hubMachines(env.desktop)}>
        <Paired env={env} />
      </HubContext.Provider>
    </MachineContext.Provider>
  );
}

function Paired({ env }: { env: AppEnv }) {
  const [auth, setAuth] = useState<Auth | null>(() => env.desktopAuth ?? loadAuth(env.storage));
  const [notice, setNotice] = useState("");
  const [code, setCode] = useState(() => (auth ? "" : pairCodeFromHash(env.hash)));
  const [hash, setHash] = useState(env.hash);
  const { storage, onHashChange } = env;
  useEffect(() => onHashChange(setHash), [onHashChange]);
  const unpair = useCallback(() => {
    clearAuth(storage);
    setAuth(null);
  }, [storage]);
  const refused = useCallback(() => {
    unpair();
    setNotice(refusedNotice);
  }, [unpair]);
  if (auth) {
    const signOut = async () => {
      await disablePush(env.push ?? noPush, env.fetch, auth.token);
      setNotice("");
      unpair();
      await unpairDevice(env.fetch, auth.token).catch(() => undefined);
    };
    return <Connected env={{ ...env, hash }} auth={auth} onUnauthorized={refused} onSignOut={signOut} />;
  }
  if (!env.installed) {
    return <Install code={code} host={env.host} />;
  }
  return (
    <Pair
      env={env}
      code={code}
      notice={notice}
      onPaired={(paired) => {
        setNotice("");
        setCode("");
        setAuth(saveAuth(env.storage, paired));
      }}
    />
  );
}
