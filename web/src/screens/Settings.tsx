import { useEffect, useState, type ReactNode } from "react";
import type { Authed, Fetch } from "../api";
import type { Auth, KeyValue } from "../auth";
import { confirmEnd, setConfirmEnd } from "../commands";
import { disablePush, enablePush, type PushEnv } from "../push";
import { applyTheme, clamp, fontSizes, lineHeights, loadSettings, saveSettings, type AppSettings, type Appearance, type EventAlert, type General, type NotificationSettings } from "../settings";
import { assignShortcut, comboFor, comboFromEvent, comboLabel, defaultShortcuts, restoreShortcut, shortcutActions, type Shortcuts } from "../shortcuts";
import { Checkbox, Select, Stepper } from "../ui";
import { Brand } from "./Brand";
import { AgentsGroup, ServerAppearanceGroup, ServerNotificationsGroup, WorkspacesGroup } from "./ServerSettings";

type Notify = { state: "idle" } | { state: "checking" } | { state: "busy" } | { state: "on"; error?: string } | { state: "denied" } | { state: "failed"; message: string };

type GroupId = "general" | "notifications" | "appearance" | "shortcuts" | "server-workspaces" | "server-agents" | "server-notifications" | "server-appearance";

const appGroups: { id: GroupId; title: string }[] = [
  { id: "general", title: "General" },
  { id: "notifications", title: "Notifications" },
  { id: "appearance", title: "Appearance" },
  { id: "shortcuts", title: "Shortcuts" },
];

const serverGroups: { id: GroupId; title: string }[] = [
  { id: "server-workspaces", title: "Workspaces" },
  { id: "server-agents", title: "Agents" },
  { id: "server-notifications", title: "Notifications" },
  { id: "server-appearance", title: "Appearance" },
];

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
};

function PushCard({ auth, installed, fetch, push, desktop }: Pick<SettingsProps, "auth" | "installed" | "fetch" | "push" | "desktop">) {
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
      setNotify({ state: "failed", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function disable() {
    setNotify({ state: "busy" });
    const error = await disablePush(push, fetch, auth.token);
    setNotify(error === null ? { state: "idle" } : { state: "on", error });
  }

  return (
    <section className="card" aria-label="Notifications">
      <h2>Notifications</h2>
      {!installed && !desktop && (
        <p className="muted">
          On iPhone and iPad, notifications work only in the app opened from the Home Screen. Add crew to your Home Screen,
          then open it from there.
        </p>
      )}
      {!push.supported ? (
        !desktop && <p className="muted">This browser cannot show notifications from crew.</p>
      ) : (
        <>
          <p className="muted">Get a notification when a session needs you, waits for an answer or finishes.</p>
          <p className="muted">
            Held while you're typing at the terminal, and sent once if you step away with a session still waiting. Not sent
            while this app is open on screen.
          </p>
          {notify.state === "on" && <p>Notifications are on for this device.</p>}
          {notify.state === "denied" && <p className="error">Notifications are blocked. Allow them for crew in your device's settings, then try again.</p>}
          {notify.state === "on" && notify.error && (
            <p className="error" role="alert">
              {notify.error}
            </p>
          )}
          {notify.state === "failed" && (
            <p className="error" role="alert">
              {notify.message}
            </p>
          )}
          {notify.state === "on" ? (
            <button type="button" className="secondary" onClick={disable}>
              Turn off
            </button>
          ) : (
            <button type="button" onClick={enable} disabled={notify.state === "busy" || notify.state === "checking"}>
              Enable notifications
            </button>
          )}
        </>
      )}
    </section>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Checkbox label={label} checked={checked} onChange={onChange} />
  );
}

function Pick<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="ui-field">
      {label}
      <Select label={label} value={value} onChange={onChange} options={options.map(([v, title]) => ({ value: v, label: title }))} />
    </div>
  );
}

function NumberField({ label, value, step, onCommit }: { label: string; value: number; step?: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <div className="ui-field">
      {label}
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
    </div>
  );
}

function GeneralPane({ general, storage, onChange }: { general: General; storage: KeyValue; onChange: (g: General) => void }) {
  const [askEnd, setAskEnd] = useState(() => confirmEnd(storage));
  return (
    <section className="card" aria-label="General">
      <h2>General</h2>
      <NumberField label="Ended sessions shown" value={general.endedShown} onCommit={(n) => onChange({ ...general, endedShown: Math.max(0, Math.round(n)) })} />
      <Check
        label="Ask before I end a session"
        checked={askEnd}
        onChange={(v) => {
          setAskEnd(v);
          setConfirmEnd(storage, v);
        }}
      />
      <Check label="Show worktrees in the sidebar" checked={general.showWorktrees} onChange={(v) => onChange({ ...general, showWorktrees: v })} />
      <Check label="Show subagents" checked={general.showSubagents} onChange={(v) => onChange({ ...general, showSubagents: v })} />
    </section>
  );
}

const events: { key: keyof Pick<NotificationSettings, "permission" | "waiting" | "done" | "limitOrError">; title: string }[] = [
  { key: "permission", title: "Permission" },
  { key: "waiting", title: "Waiting" },
  { key: "done", title: "Done" },
  { key: "limitOrError", title: "Limit or error" },
];

function NotificationsPane({ value, onChange }: { value: NotificationSettings; onChange: (n: NotificationSettings) => void }) {
  const set = (key: (typeof events)[number]["key"], alert: EventAlert) => onChange({ ...value, [key]: alert });
  return (
    <section className="card" aria-label="Alerts">
      <h2>Alerts</h2>
      {events.map((e) => (
        <div key={e.key} className="alert-row">
          <span>{e.title}</span>
          <Check label={e.title + ": banner"} checked={value[e.key].banner} onChange={(v) => set(e.key, { ...value[e.key], banner: v })} />
          <Check label={e.title + ": sound"} checked={value[e.key].sound} onChange={(v) => set(e.key, { ...value[e.key], sound: v })} />
        </div>
      ))}
      <Check label="Skip the session that is on screen" checked={value.skipSessionInView} onChange={(v) => onChange({ ...value, skipSessionInView: v })} />
      <Check label="Also notify for muted sessions" checked={value.notifyMuted} onChange={(v) => onChange({ ...value, notifyMuted: v })} />
    </section>
  );
}

function AppearancePane({ value, onChange }: { value: Appearance; onChange: (a: Appearance) => void }) {
  return (
    <section className="card" aria-label="Appearance">
      <h2>Appearance</h2>
      <Pick label="Theme" value={value.theme} options={[["system", "Match system"], ["latte", "Latte"], ["mocha", "Mocha"]]} onChange={(theme) => onChange({ ...value, theme })} />
      <Pick label="Accent" value={value.accent} options={[["blue", "Blue"], ["peach", "Peach"], ["green", "Green"], ["red", "Red"]]} onChange={(accent) => onChange({ ...value, accent })} />
      <label>
        Terminal font
        <input type="text" value={value.terminalFont} onChange={(e) => onChange({ ...value, terminalFont: e.target.value })} />
      </label>
      <NumberField label="Terminal font size" value={value.fontSize} onCommit={(n) => onChange({ ...value, fontSize: clamp(n, fontSizes) })} />
      <NumberField label="Line height" step={0.1} value={value.lineHeight} onCommit={(n) => onChange({ ...value, lineHeight: clamp(n, lineHeights) })} />
      <Pick label="Cursor" value={value.cursor} options={[["block", "Block"], ["bar", "Bar"], ["underline", "Underline"]]} onChange={(cursor) => onChange({ ...value, cursor })} />
      <Check label="Blinking cursor" checked={value.cursorBlinks} onChange={(v) => onChange({ ...value, cursorBlinks: v })} />
      <Pick label="Density" value={value.density} options={[["regular", "Regular"], ["compact", "Compact"]]} onChange={(density) => onChange({ ...value, density })} />
      <Pick label="Diff layout" value={value.diffLayout} options={[["unified", "Unified"], ["split", "Split"]]} onChange={(diffLayout) => onChange({ ...value, diffLayout })} />
    </section>
  );
}

function ShortcutsPane({ value, mac, onChange }: { value: Shortcuts; mac: boolean; onChange: (s: Shortcuts) => void }) {
  const [recording, setRecording] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!recording) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
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
    <section className="card" aria-label="Shortcuts">
      <h2>Shortcuts</h2>
      <p className="muted">Each shortcut needs {mac ? "⌘ or ⌃" : "Ctrl or Meta"}, so the terminal keeps plain keys.</p>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <Check label="Send other keys to the terminal" checked={value.passThrough} onChange={(v) => onChange({ ...value, passThrough: v })} />
      <table className="shortcuts">
        <tbody>
          {shortcutActions.map((a) => {
            const combo = comboFor(value, a.id);
            return (
              <tr key={a.id}>
                <th scope="row">{a.title}</th>
                <td>{recording === a.id ? "Press keys…" : combo ? <kbd>{comboLabel(combo, mac)}</kbd> : <span className="muted">None</span>}</td>
                <td className="shortcut-actions">
                  <button type="button" className="ghost" onClick={() => setRecording(a.id)}>
                    Change
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      const out = assignShortcut(value, a.id, null);
                      if (out.ok) {
                        onChange(out.shortcuts);
                      }
                    }}
                  >
                    Clear
                  </button>
                  <button type="button" className="ghost" onClick={() => onChange(restoreShortcut(value, a.id))}>
                    Default
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="button" className="secondary" onClick={() => onChange({ ...defaultShortcuts(), passThrough: value.passThrough })}>
        Restore all defaults
      </button>
    </section>
  );
}

function GroupNav({ label, groups, current, onPick }: { label: string; groups: { id: GroupId; title: string }[]; current: GroupId; onPick: (g: GroupId) => void }) {
  return (
    <>
      <h2 className="settings-nav-title">{label}</h2>
      <ul aria-label={label} className="settings-nav">
        {groups.map((g) => (
          <li key={g.id}>
            <button type="button" aria-current={g.id === current ? "page" : undefined} onClick={() => onPick(g.id)}>
              {g.title}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function Settings({ auth, host, installed, fetch, push, onSignOut, storage, userAgent, connectUrl, desktop }: SettingsProps) {
  const [group, setGroup] = useState<GroupId>("general");
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings(storage));
  const api: Authed = { fetch, token: auth.token };
  const mac = /Macintosh/.test(userAgent);

  useEffect(() => applyTheme(settings.appearance.theme), [settings.appearance.theme]);

  const update = (next: AppSettings) => {
    setSettings(next);
    saveSettings(storage, next);
  };

  let pane: ReactNode;
  switch (group) {
    case "general":
      pane = (
        <>
          <section className="card" aria-label="Server">
            <h2>Server</h2>
            <dl className="server">
              <dt>Address</dt>
              <dd>{host}</dd>
            </dl>
            {connectUrl ? (
              <a className="change-server" href={connectUrl}>
                Change server
              </a>
            ) : null}
          </section>
          <section className="card" aria-label="This device">
            <h2>This device</h2>
            <dl className="server">
              <dt>Name</dt>
              <dd>{auth.device.name}</dd>
              <dt>ID</dt>
              <dd>{auth.device.id}</dd>
            </dl>
          </section>
          {!(desktop && !push.supported) && <PushCard auth={auth} installed={installed} fetch={fetch} push={push} desktop={desktop} />}
          <GeneralPane general={settings.general} storage={storage} onChange={(general) => update({ ...settings, general })} />
          <button type="button" className="secondary" onClick={onSignOut}>
            Sign out
          </button>
        </>
      );
      break;
    case "notifications":
      pane = <NotificationsPane value={settings.notifications} onChange={(notifications) => update({ ...settings, notifications })} />;
      break;
    case "appearance":
      pane = <AppearancePane value={settings.appearance} onChange={(appearance) => update({ ...settings, appearance })} />;
      break;
    case "shortcuts":
      pane = <ShortcutsPane value={settings.shortcuts} mac={mac} onChange={(shortcuts) => update({ ...settings, shortcuts })} />;
      break;
    case "server-workspaces":
      pane = <WorkspacesGroup api={api} />;
      break;
    case "server-agents":
      pane = <AgentsGroup api={api} />;
      break;
    case "server-notifications":
      pane = <ServerNotificationsGroup api={api} self={auth.device.id} />;
      break;
    case "server-appearance":
      pane = <ServerAppearanceGroup api={api} />;
      break;
  }

  return (
    <main className="screen settings-screen">
      <Brand host={host} />
      <h1>Settings</h1>
      <div className="settings-layout">
        <nav className="settings-groups" aria-label="Settings groups">
          <GroupNav label="This app" groups={appGroups} current={group} onPick={setGroup} />
          <GroupNav label="Server" groups={serverGroups} current={group} onPick={setGroup} />
        </nav>
        <div className="settings-pane">{pane}</div>
      </div>
    </main>
  );
}
