import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { tokenRefused, unpairDevice, type Fetch } from "./api";
import { clearAuth, loadAuth, saveAuth, type Auth, type KeyValue } from "./auth";
import { pairCodeFromHash } from "./display";
import { disablePush, noPush, type PushEnv } from "./push";
import { parseRoute } from "./route";
import { Approvals } from "./screens/Approvals";
import { Automations } from "./screens/Automations";
import { Desktop } from "./screens/Desktop";
import { MateProfile, Mates, NewMate } from "./screens/Mates";
import { Install } from "./screens/Install";
import { NewSession } from "./screens/NewSession";
import { Pair } from "./screens/Pair";
import { SessionScreen } from "./screens/Session";
import { SessionList } from "./screens/SessionList";
import { Settings } from "./screens/Settings";
import { useStream, useStreamClient, type OpenSocket } from "./stream";

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

type Tab = "sessions" | "mates" | "approvals" | "automations" | "settings";

function Tabs({ current }: { current: Tab }) {
  const mark = (tab: Tab) => (current === tab ? "page" : undefined);
  return (
    <nav className="tabs" aria-label="Screens">
      <a href="#/" aria-current={mark("sessions")}>
        Sessions
      </a>
      <a href="#/mates" aria-current={mark("mates")}>
        Mates
      </a>
      <a href="#/approvals" aria-current={mark("approvals")}>
        Approvals
      </a>
      <a href="#/automations" aria-current={mark("automations")}>
        Automations
      </a>
      <a href="#/settings" aria-current={mark("settings")}>
        Settings
      </a>
    </nav>
  );
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
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

  useEffect(() => onHashChange(setHash), [onHashChange]);

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
  const other = otherScreen(hash, { env, auth, api, now, snapshot, onSignOut });
  if (wide) {
    return (
      <Desktop
        env={env}
        token={auth.token}
        hash={hash}
        go={go}
        snapshot={snapshot}
        now={now}
        onRetry={retry}
        client={client}
        api={api}
        other={other?.screen ?? null}
      />
    );
  }
  if (route.screen === "new") {
    return <NewSession env={env} token={auth.token} />;
  }
  if (route.screen === "session") {
    return <SessionScreen key={route.id} id={route.id} snapshot={snapshot} now={now} onRetry={retry} client={client} api={api} />;
  }
  if (other) {
    return (
      <>
        {other.screen}
        <Tabs current={other.tab} />
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
      <Tabs current="sessions" />
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
};

function otherScreen(hash: string, { env, auth, api, now, snapshot, onSignOut }: OtherInputs): { screen: ReactNode; tab: Tab } | null {
  if (hash === "#/automations") {
    return { screen: <Automations api={api} />, tab: "automations" };
  }
  if (hash === "#/mates") {
    return { screen: <Mates api={api} now={now} board={snapshot.state?.mates} />, tab: "mates" };
  }
  if (hash.startsWith("#/mates/")) {
    const name = hash.slice("#/mates/".length);
    return {
      screen: name === "new" ? <NewMate api={api} /> : <MateProfile api={api} name={safeDecode(name)} board={snapshot.state?.mates} />,
      tab: "mates",
    };
  }
  if (hash === "#/approvals") {
    return { screen: <Approvals api={api} now={now} visibility={env.visibility} />, tab: "approvals" };
  }
  if (hash === "#/settings") {
    return {
      screen: (
        <Settings
          auth={auth}
          host={env.host}
          installed={env.installed}
          fetch={env.fetch}
          push={env.push ?? noPush}
          onSignOut={onSignOut}
          storage={env.storage}
          userAgent={env.userAgent}
        />
      ),
      tab: "settings",
    };
  }
  return null;
}

const refusedNotice =
  "This device was removed from crew, or the server rejected its login. Pair it again with a new code from crew remote pair.";

export function App({ env }: { env: AppEnv }) {
  const [auth, setAuth] = useState<Auth | null>(() => env.desktopAuth ?? loadAuth(env.storage));
  const [notice, setNotice] = useState("");
  const [code, setCode] = useState(() => (auth ? "" : pairCodeFromHash(env.hash)));
  const { storage } = env;
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
    return <Connected env={env} auth={auth} onUnauthorized={refused} onSignOut={signOut} />;
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
