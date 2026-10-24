import { useEffect, useState, type ReactNode } from "react";
import { hello, type Authed, type Fetch } from "../api";
import type { Auth, KeyValue } from "../auth";
import { confirmEnd, setConfirmEnd } from "../commands";
import {
  loadAlertPrefs,
  saveAlertPrefs,
  type AlertPrefs,
} from "../desktopAttention";
import { disablePush, enablePush, type PushEnv } from "../push";
import type { Servers } from "../servers";
import {
  applyTheme,
  clamp,
  fontSizes,
  lineHeights,
  loadSettings,
  saveSettings,
  type AppSettings,
  type Appearance,
  type General,
} from "../settings";
import {
  assignShortcut,
  comboFor,
  comboFromEvent,
  comboLabel,
  defaultShortcuts,
  restoreShortcut,
  shortcutActions,
  type Shortcuts,
} from "../shortcuts";
import { Button, Segmented, Select, Stepper, Switch } from "../ui";
import {
  AgentsGroup,
  DevicesGroup,
  MatesGroup,
  PushDelayRow,
  WorkspacesGroup,
} from "./ServerSettings";
import { ServersScreen } from "./Servers";
import { Group, Opt } from "./SettingsRows";

type Notify =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "busy" }
  | { state: "on"; error?: string }
  | { state: "denied" }
  | { state: "failed"; message: string };

export type GroupId =
  | "general"
  | "notifications"
  | "appearance"
  | "mates"
  | "sessions"
  | "shortcuts"
  | "devices"
  | "servers"
  | "about";

const allGroups: { id: GroupId; title: string }[] = [
  { id: "general", title: "General" },
  { id: "notifications", title: "Notifications" },
  { id: "appearance", title: "Appearance" },
  { id: "mates", title: "Mates and Slack" },
  { id: "sessions", title: "Sessions" },
  { id: "shortcuts", title: "Shortcuts" },
  { id: "devices", title: "Devices" },
  { id: "about", title: "About" },
];

export type UpdateCheck = { current: string; latest: string | null };

export type SettingsProps = {
  auth: Auth;
  host: string;
  installed: boolean;
  fetch: Fetch;
  push: PushEnv;
  onSignOut: () => void | Promise<void>;
  storage: KeyValue;
  userAgent: string;
  connectUrl?: string;
  desktop?: boolean;
  local?: boolean;
  servers?: Servers;
  initial?: GroupId;
  checkUpdate?: () => Promise<UpdateCheck>;
};

function PushCard({
  auth,
  installed,
  fetch,
  push,
  desktop,
}: Pick<SettingsProps, "auth" | "installed" | "fetch" | "push" | "desktop">) {
  const [notify, setNotify] = useState<Notify>(() => {
    if (!push.supported) {
      return { state: "idle" };
    }
    const permission = push.permission();
    if (permission === "denied") {
      return { state: "denied" };
    }
    return permission === "granted" ? { state: "checking" } : { state: "idle" };
  });

  useEffect(() => {
    if (notify.state !== "checking") {
      return;
    }
    let live = true;
    push
      .subscribed()
      .catch(() => false)
      .then((on) => {
        if (live) {
          setNotify({ state: on ? "on" : "idle" });
        }
      });
    return () => {
      live = false;
    };
  }, [notify.state, push]);

  async function enable() {
    setNotify({ state: "busy" });
    try {
      setNotify({ state: await enablePush(push, fetch, auth.token) });
    } catch (err) {
      setNotify({
        state: "failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function disable() {
    setNotify({ state: "busy" });
    const error = await disablePush(push, fetch, auth.token);
    setNotify(error === null ? { state: "idle" } : { state: "on", error });
  }

  return (
    <section className="set-section" aria-label="Notifications">
      <div className="gtitle">NOTIFICATIONS ON THIS DEVICE</div>
      <div className="group">
        {!installed && !desktop && (
          <Opt sub="On iPhone and iPad, notifications work only in the app opened from the Home Screen. Add crew to your Home Screen, then open it from there." />
        )}
        {!push.supported ? (
          !desktop && (
            <Opt sub="This browser cannot show notifications from crew." />
          )
        ) : (
          <Opt
            lead={
              <span className={"dot" + (notify.state === "on" ? " ok" : "")} />
            }
            title={
              notify.state === "on"
                ? "Notifications are on for this device."
                : "Get a notification when a session needs you, waits for an answer or finishes."
            }
            sub={
              <>
                Held while you're typing at the terminal, and sent once if you
                step away with a session still waiting. Not sent while this app
                is open on screen.
                {notify.state === "denied" && (
                  <span className="error">
                    {" "}
                    Notifications are blocked. Allow them for crew in your
                    device's settings, then try again.
                  </span>
                )}
                {notify.state === "on" && notify.error && (
                  <span className="error" role="alert">
                    {" " + notify.error}
                  </span>
                )}
                {notify.state === "failed" && (
                  <span className="error" role="alert">
                    {" " + notify.message}
                  </span>
                )}
              </>
            }
          >
            {notify.state === "on" ? (
              <Button className="sm" onClick={disable}>
                Turn off
              </Button>
            ) : (
              <Button
                variant="primary"
                className="sm"
                onClick={enable}
                disabled={
                  notify.state === "busy" || notify.state === "checking"
                }
              >
                Enable notifications
              </Button>
            )}
          </Opt>
        )}
      </div>
    </section>
  );
}

function Count({
  label,
  value,
  step,
  onCommit,
}: {
  label: string;
  value: number;
  step?: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <Stepper
      label={label}
      step={step}
      value={text}
      onChange={(next) => {
        setText(next);
        if (next !== "" && !Number.isNaN(Number(next))) {
          onCommit(Number(next));
        }
      }}
      onBlur={() => setText(String(value))}
    />
  );
}

function SwitchRow({
  title,
  sub,
  checked,
  onChange,
}: {
  title: string;
  sub?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Opt title={title} sub={sub}>
      <Switch
        label={null}
        ariaLabel={title}
        checked={checked}
        onChange={onChange}
      />
    </Opt>
  );
}

function GeneralPane({
  general,
  onChange,
}: {
  general: General;
  onChange: (g: General) => void;
}) {
  return (
    <Group label="Sidebar" title="SIDEBAR">
      <Opt
        title="Ended sessions shown"
        sub="The most recent ones, under Ended"
      >
        <Count
          label="Ended sessions shown"
          value={general.endedShown}
          onCommit={(n) =>
            onChange({ ...general, endedShown: Math.max(0, Math.round(n)) })
          }
        />
      </Opt>
      <SwitchRow
        title="Show worktrees"
        checked={general.showWorktrees}
        onChange={(v) => onChange({ ...general, showWorktrees: v })}
      />
      <SwitchRow
        title="Show subagents"
        sub="Nested under the session that started them"
        checked={general.showSubagents}
        onChange={(v) => onChange({ ...general, showSubagents: v })}
      />
    </Group>
  );
}

function SessionsPane({ storage }: { storage: KeyValue }) {
  const [askEnd, setAskEnd] = useState(() => confirmEnd(storage));
  return (
    <Group label="Sessions" title="SESSIONS">
      <SwitchRow
        title="Ask before I end a session"
        checked={askEnd}
        onChange={(v) => {
          setAskEnd(v);
          setConfirmEnd(storage, v);
        }}
      />
    </Group>
  );
}

function AboutPane({
  fetch,
  checkUpdate,
}: {
  fetch: Fetch;
  checkUpdate?: () => Promise<UpdateCheck>;
}) {
  const [build, setBuild] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    hello(fetch).then(
      (h) => live && setBuild(h.build),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [fetch]);
  const check = async () => {
    if (!checkUpdate) {
      return;
    }
    setBusy(true);
    try {
      const r = await checkUpdate();
      setStatus(
        r.latest
          ? "crew " + r.latest + " is available."
          : "crew " + r.current + " is the newest version.",
      );
    } catch (err) {
      setStatus("The update check failed: " + String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Group label="Version" title="VERSION">
        <Opt title="Server build">
          <span className="mono">{build}</span>
        </Opt>
        {checkUpdate ? (
          <Opt title="Updates" sub="The app also checks at start and every 6 hours">
            <Button className="sm" disabled={busy} onClick={() => void check()}>
              Check for updates
            </Button>
          </Opt>
        ) : null}
      </Group>
      {status ? (
        <p className="settings-notice" role="status">
          {status}
        </p>
      ) : null}
      <Group label="Links" title="LINKS">
        <Opt title="Source on GitHub">
          <a className="ui btn sm" href="https://github.com/giovaniif/crew" target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
        </Opt>
        <Opt title="Releases">
          <a className="ui btn sm" href="https://github.com/giovaniif/crew/releases" target="_blank" rel="noreferrer">
            Releases
          </a>
        </Opt>
      </Group>
    </>
  );
}

type EventKey = "permission" | "waiting" | "done" | "limitOrError" | "mateNeeds" | "mateDone" | "automationFailed" | "prChecksFailed";

const mateEvents: { key: EventKey; title: string; sub?: string }[] = [
  { key: "mateNeeds", title: "A mate needs you", sub: "Approval or a question" },
  { key: "mateDone", title: "A mate finished a thread" },
  { key: "automationFailed", title: "An automation failed" },
];

const sessionEvents: { key: EventKey; title: string; sub?: string }[] = [
  { key: "permission", title: "Session asks permission" },
  { key: "waiting", title: "Session waits for an answer" },
  { key: "done", title: "Session finished" },
  { key: "limitOrError", title: "Session hits a limit or an error" },
  { key: "prChecksFailed", title: "PR checks failed" },
];

const sounds: { value: "none" | "default"; label: string }[] = [
  { value: "none", label: "None" },
  { value: "default", label: "Default" },
];

function EventGroup({
  label,
  rows,
  value,
  onChange,
}: {
  label: string;
  rows: { key: EventKey; title: string; sub?: string }[];
  value: AlertPrefs;
  onChange: (next: AlertPrefs) => void;
}) {
  return (
    <Group label={label} title={label.toUpperCase()}>
      <div className="nrow h" aria-hidden="true">
        <span>Event</span>
        <span>Banner</span>
        <span>Sound</span>
      </div>
      {rows.map((e) => (
        <div key={e.key} className="nrow">
          <span className="t">
            {e.title}
            {e.sub ? <span className="s">{e.sub}</span> : null}
          </span>
          <Switch
            label={null}
            ariaLabel={e.title}
            checked={value[e.key].banner}
            onChange={(v) => onChange({ ...value, [e.key]: { ...value[e.key], banner: v } })}
          />
          <Select
            label={"Sound when " + (e.title.startsWith("PR") ? e.title : e.title.toLowerCase())}
            value={value[e.key].sound ? "default" : "none"}
            options={sounds}
            onChange={(v) => onChange({ ...value, [e.key]: { ...value[e.key], sound: v === "default" } })}
          />
        </div>
      ))}
    </Group>
  );
}

function NotificationsPane({
  storage,
  api,
}: {
  storage: KeyValue;
  api: Authed;
}) {
  const [value, setValue] = useState<AlertPrefs>(() => loadAlertPrefs(storage));
  const onChange = (next: AlertPrefs) => {
    saveAlertPrefs(storage, next);
    setValue(next);
  };
  return (
    <>
      <EventGroup label="Mates" rows={mateEvents} value={value} onChange={onChange} />
      <EventGroup label="Sessions" rows={sessionEvents} value={value} onChange={onChange} />
      <Group label="Options" title="OPTIONS">
        <SwitchRow
          title="Skip the session that is on screen"
          checked={value.skipSessionInView}
          onChange={(v) => onChange({ ...value, skipSessionInView: v })}
        />
        <SwitchRow
          title="Also notify for muted sessions"
          checked={value.notifyMuted}
          onChange={(v) => onChange({ ...value, notifyMuted: v })}
        />
        <PushDelayRow api={api} />
      </Group>
    </>
  );
}

const accents: { value: Appearance["accent"]; label: string; color: string }[] =
  [
    { value: "blue", label: "Blue", color: "oklch(0.55 0.15 255)" },
    { value: "green", label: "Green", color: "oklch(0.55 0.15 150)" },
    { value: "peach", label: "Peach", color: "oklch(0.65 0.15 55)" },
    { value: "red", label: "Red", color: "oklch(0.55 0.15 25)" },
  ];

function AppearancePane({
  value,
  onChange,
}: {
  value: Appearance;
  onChange: (a: Appearance) => void;
}) {
  return (
    <Group label="Appearance">
      <Opt title="Theme">
        <Segmented
          label="Theme"
          value={value.theme}
          options={[
            { value: "system", label: "System" },
            { value: "latte", label: "Light" },
            { value: "mocha", label: "Dark" },
          ]}
          onChange={(theme) => onChange({ ...value, theme })}
        />
      </Opt>
      <Opt title="Accent">
        <div role="radiogroup" aria-label="Accent" className="accents">
          {accents.map((a) => (
            <button
              key={a.value}
              type="button"
              role="radio"
              aria-checked={value.accent === a.value}
              aria-label={a.label}
              className={"swatch" + (value.accent === a.value ? " on" : "")}
              style={{ background: a.color }}
              onClick={() => onChange({ ...value, accent: a.value })}
            />
          ))}
        </div>
      </Opt>
      <Opt title="Density">
        <Segmented
          label="Density"
          value={value.density}
          options={[
            { value: "regular", label: "Comfortable" },
            { value: "compact", label: "Compact" },
          ]}
          onChange={(density) => onChange({ ...value, density })}
        />
      </Opt>
      <Opt title="Diff layout">
        <Segmented
          label="Diff layout"
          value={value.diffLayout}
          options={[
            { value: "unified", label: "Unified" },
            { value: "split", label: "Split" },
          ]}
          onChange={(diffLayout) => onChange({ ...value, diffLayout })}
        />
      </Opt>
      <Opt title="Terminal font">
        <input
          className="ui input"
          aria-label="Terminal font"
          type="text"
          value={value.terminalFont}
          onChange={(e) => onChange({ ...value, terminalFont: e.target.value })}
        />
      </Opt>
      <Opt title="Terminal font size">
        <Count
          label="Terminal font size"
          value={value.fontSize}
          onCommit={(n) =>
            onChange({ ...value, fontSize: clamp(n, fontSizes) })
          }
        />
      </Opt>
      <Opt title="Line height">
        <Count
          label="Line height"
          step={0.1}
          value={value.lineHeight}
          onCommit={(n) =>
            onChange({ ...value, lineHeight: clamp(n, lineHeights) })
          }
        />
      </Opt>
      <Opt title="Cursor">
        <Segmented
          label="Cursor"
          value={value.cursor}
          options={[
            { value: "block", label: "Block" },
            { value: "underline", label: "Underline" },
            { value: "bar", label: "Bar" },
          ]}
          onChange={(cursor) => onChange({ ...value, cursor })}
        />
        <Switch
          label={null}
          ariaLabel="Blinking cursor"
          checked={value.cursorBlinks}
          onChange={(v) => onChange({ ...value, cursorBlinks: v })}
        />
      </Opt>
    </Group>
  );
}

function ShortcutsPane({
  value,
  mac,
  onChange,
}: {
  value: Shortcuts;
  mac: boolean;
  onChange: (s: Shortcuts) => void;
}) {
  const [recording, setRecording] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!recording) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        setRecording(null);
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const out = assignShortcut(value, recording, combo);
      setRecording(null);
      if (out.ok) {
        setError("");
        onChange(out.shortcuts);
      } else {
        setError(out.message);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, value, onChange]);

  return (
    <>
      <p className="set-lead">
        Each shortcut needs {mac ? "⌘ or ⌃" : "Ctrl or Meta"}, so the terminal
        keeps plain keys.
      </p>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <Group label="Keys">
        <SwitchRow
          title="Send other keys to the terminal"
          checked={value.passThrough}
          onChange={(v) => onChange({ ...value, passThrough: v })}
        />
      </Group>
      <section className="set-section" aria-label="Shortcuts">
        <div className="gtitle">SHORTCUTS</div>
        <ul className="group">
          {shortcutActions.map((a) => {
            const combo = comboFor(value, a.id);
            return (
              <li key={a.id} className="opt" aria-label={a.title}>
                <div className="l">
                  <div className="t">{a.title}</div>
                </div>
                {recording === a.id ? (
                  <span className="muted">Press keys…</span>
                ) : combo ? (
                  <kbd>{comboLabel(combo, mac)}</kbd>
                ) : (
                  <span className="muted">None</span>
                )}
                <Button
                  variant="quiet"
                  className="sm"
                  onClick={() => setRecording(a.id)}
                >
                  Change
                </Button>
                <Button
                  variant="quiet"
                  className="sm"
                  onClick={() => {
                    const out = assignShortcut(value, a.id, null);
                    if (out.ok) {
                      onChange(out.shortcuts);
                    }
                  }}
                >
                  Clear
                </Button>
                <Button
                  variant="quiet"
                  className="sm"
                  onClick={() => onChange(restoreShortcut(value, a.id))}
                >
                  Default
                </Button>
              </li>
            );
          })}
        </ul>
      </section>
      <Button
        onClick={() =>
          onChange({ ...defaultShortcuts(), passThrough: value.passThrough })
        }
      >
        Restore all defaults
      </Button>
    </>
  );
}

export function Settings({
  auth,
  host,
  installed,
  fetch,
  push,
  onSignOut,
  storage,
  userAgent,
  connectUrl,
  desktop,
  local,
  servers,
  initial,
  checkUpdate,
}: SettingsProps) {
  const [group, setGroup] = useState<GroupId>(initial ?? "general");
  const [settings, setSettings] = useState<AppSettings>(() =>
    loadSettings(storage),
  );
  const api: Authed = { fetch, token: auth.token };
  const mac = /Macintosh/.test(userAgent);
  const groups = allGroups.filter((g) => g.id !== "servers" || servers);

  useEffect(
    () => applyTheme(settings.appearance.theme),
    [settings.appearance.theme],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !e.defaultPrevented &&
        !document.querySelector('[role="dialog"], .ui.menu')
      ) {
        window.location.hash = "#/";
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const update = (next: AppSettings) => {
    setSettings(next);
    saveSettings(storage, next);
  };

  const title = groups.find((g) => g.id === group)?.title ?? "";
  let pane: ReactNode;
  switch (group) {
    case "general":
      pane = (
        <>
          <GeneralPane
            general={settings.general}
            onChange={(general) => update({ ...settings, general })}
          />
          <section className="set-section" aria-label="This device">
            <div className="gtitle">THIS DEVICE</div>
            <div className="group">
              <Opt title="Name" sub={auth.device.id}>
                <span>{auth.device.name}</span>
              </Opt>
            </div>
          </section>
          <section className="set-section" aria-label="Server">
            <div className="gtitle">SERVER</div>
            <div className="group">
              <Opt title="Address">
                <span className="mono">{host}</span>
                {connectUrl ? (
                  <a className="ui btn sm change-server" href={connectUrl}>
                    Change server
                  </a>
                ) : null}
              </Opt>
            </div>
          </section>
          {!(desktop && !push.supported) && (
            <PushCard
              auth={auth}
              installed={installed}
              fetch={fetch}
              push={push}
              desktop={desktop}
            />
          )}
          {local ? null : (
            <Button variant="danger" onClick={onSignOut}>
              Sign out
            </Button>
          )}
        </>
      );
      break;
    case "notifications":
      pane = <NotificationsPane storage={storage} api={api} />;
      break;
    case "appearance":
      pane = (
        <AppearancePane
          value={settings.appearance}
          onChange={(appearance) => update({ ...settings, appearance })}
        />
      );
      break;
    case "shortcuts":
      pane = (
        <ShortcutsPane
          value={settings.shortcuts}
          mac={mac}
          onChange={(shortcuts) => update({ ...settings, shortcuts })}
        />
      );
      break;
    case "devices":
      pane = <DevicesGroup api={api} self={auth.device.id} />;
      break;
    case "mates":
      pane = <MatesGroup api={api} />;
      break;
    case "sessions":
      pane = (
        <>
          <SessionsPane storage={storage} />
          <WorkspacesGroup
            api={api}
            pickFolder={servers ? (near) => servers.pickFolder(near) : undefined}
          />
          <AgentsGroup api={api} />
        </>
      );
      break;
    case "about":
      pane = <AboutPane fetch={fetch} checkUpdate={checkUpdate} />;
      break;
    case "servers":
      pane = servers ? <ServersScreen servers={servers} /> : null;
      break;
  }
  const own = group === "mates" || group === "devices" || group === "servers";

  return (
    <main className="screen settings-screen">
      <h1 className="visually-hidden">Settings</h1>
      <div className="set">
        <nav className="snav" aria-label="Settings">
          <a className="row back" href="#/">
            <span className="nm">‹ Back</span>
            <span className="meta">Esc</span>
          </a>
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              className={"row" + (g.id === group ? " on" : "")}
              aria-current={g.id === group ? "page" : undefined}
              onClick={() => setGroup(g.id)}
            >
              {g.title}
            </button>
          ))}
        </nav>
        <div className="sbody">
          {own ? null : <h2 className="set-title">{title}</h2>}
          {pane}
        </div>
      </div>
    </main>
  );
}
