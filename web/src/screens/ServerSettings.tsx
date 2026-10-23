import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  addWorkspace,
  expandPath,
  getConfig,
  getOnboarding,
  groupNote,
  listDevices,
  listWorkspaces,
  newPairCode,
  removeWorkspace,
  revokeDevice,
  sessionOptions,
  setConfig,
  setHooks,
  setUpNvim,
  workspaceDirs,
  type Authed,
  type ConfigValues,
  type Device,
  type HarnessChoices,
  type Onboarding,
  type PairCode,
  type WorkspaceInfo,
} from "../api";
import { Select, Stepper } from "../ui";

type Loaded<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "failed"; note: string };

function useLoad<T>(load: () => Promise<T>): [Loaded<T>, () => void] {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: "loading" });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    load().then(
      (value) => live && setLoaded({ state: "ready", value }),
      (err) => live && setLoaded({ state: "failed", note: groupNote(err) }),
    );
    return () => {
      live = false;
    };
  }, [load, round]);
  return [loaded, useCallback(() => setRound((n) => n + 1), [])];
}

type Feedback = { notice: string; error: string };

function useFeedback() {
  const [feedback, setFeedback] = useState<Feedback>({ notice: "", error: "" });
  const run = useCallback(async (body: () => Promise<string>) => {
    try {
      const notice = await body();
      setFeedback({ notice, error: "" });
      return true;
    } catch (err) {
      setFeedback({ notice: "", error: groupNote(err) });
      return false;
    }
  }, []);
  const view = (
    <>
      {feedback.error ? (
        <p className="error" role="alert">
          {feedback.error}
        </p>
      ) : null}
      {feedback.notice ? (
        <p className="settings-notice" role="status">
          {feedback.notice}
        </p>
      ) : null}
    </>
  );
  return { run, view };
}

function Note({ text }: { text: string }) {
  return <p className="settings-note">{text}</p>;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card settings-group" aria-label={title}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function dirname(path: string): string {
  const at = path.lastIndexOf("/");
  return at <= 0 ? "/" : path.slice(0, at);
}

function useFolders(api: Authed, text: string, home: string): string[] {
  const [folders, setFolders] = useState<string[]>([]);
  useEffect(() => {
    if (!text.trim()) {
      setFolders([]);
      return;
    }
    const resolved = expandPath(text, home);
    const parent = resolved.endsWith("/") ? resolved.replace(/\/+$/, "") || "/" : dirname(resolved);
    const prefix = resolved.endsWith("/") ? "" : resolved.slice(resolved.lastIndexOf("/") + 1);
    let live = true;
    workspaceDirs(api, parent).then(
      (out) => {
        if (live) {
          setFolders((out.dirs ?? []).filter((d) => d.Name.startsWith(prefix) && d.Path !== resolved).map((d) => d.Path));
        }
      },
      () => live && setFolders([]),
    );
    return () => {
      live = false;
    };
  }, [api, text, home]);
  return folders;
}

export function WorkspacesGroup({ api }: { api: Authed }) {
  const load = useCallback(
    async () => {
      const [list, options] = await Promise.all([listWorkspaces(api.fetch, api.token), sessionOptions(api.fetch, api.token).catch(() => ({ home: "" }))]);
      return { list, home: options.home ?? "" };
    },
    [api],
  );
  const [loaded, reload] = useLoad(load);
  const [text, setText] = useState("");
  const [removing, setRemoving] = useState("");
  const { run, view } = useFeedback();
  const home = loaded.state === "ready" ? loaded.value.home : "";
  const folders = useFolders(api, text, home);
  const known = loaded.state === "ready" ? loaded.value.list.workspaces : [];
  const shown = folders.filter((f) => !known.some((w) => w.Root === f));

  const add = async () => {
    const path = expandPath(text, home);
    if (await run(async () => "Added " + (await addWorkspace(api.fetch, api.token, path)).Root)) {
      setText("");
      reload();
    }
  };
  const remove = async (root: string) => {
    if (await run(async () => (await removeWorkspace(api.fetch, api.token, root), "Removed " + root))) {
      setRemoving("");
      reload();
    }
  };

  return (
    <Group title="Workspaces">
      {loaded.state === "failed" ? <Note text={loaded.note} /> : null}
      {loaded.state === "ready" ? (
        <>
          <ul className="settings-list">
            {known.map((w: WorkspaceInfo) => (
              <li key={w.Root}>
                <span className="mono">{w.Root}</span>
                <span className="muted">{w.Kind === "orchestration" ? "orchestration root" : "single repo"}</span>
                {removing === w.Root ? (
                  <button type="button" className="secondary" onClick={() => remove(w.Root)}>
                    {"Remove " + w.Root}
                  </button>
                ) : (
                  <button type="button" className="secondary" onClick={() => setRemoving(w.Root)}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="path-field">
            <label htmlFor="workspace-path">Workspace path</label>
            <input
              id="workspace-path"
              role="combobox"
              aria-expanded={shown.length > 0}
              aria-controls="workspace-folders"
              aria-autocomplete="list"
              autoComplete="off"
              placeholder="~/code/api"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            {shown.length > 0 ? (
              <ul id="workspace-folders" role="listbox" aria-label="Folders" className="folders">
                {shown.map((f) => (
                  <li key={f} role="option" aria-selected={false} tabIndex={-1} onClick={() => setText(f)} onKeyDown={(e) => e.key === "Enter" && setText(f)}>
                    {f}
                  </li>
                ))}
              </ul>
            ) : null}
            <button type="button" disabled={!text.trim()} onClick={add}>
              Add workspace
            </button>
          </div>
        </>
      ) : null}
      {view}
    </Group>
  );
}

type AgentsData = { harnesses: HarnessChoices[]; onboarding: Onboarding; config: ConfigValues | null; configNote: string };

function harnessName(h: HarnessChoices): string {
  return h.name || h.harness;
}

export function AgentsGroup({ api }: { api: Authed }) {
  const load = useCallback(async (): Promise<AgentsData> => {
    const [options, onboarding] = await Promise.all([sessionOptions(api.fetch, api.token), getOnboarding(api)]);
    let config: ConfigValues | null = null;
    let configNote = "";
    try {
      config = await getConfig(api);
    } catch (err) {
      configNote = groupNote(err);
    }
    return { harnesses: options.harnesses as HarnessChoices[], onboarding, config, configNote };
  }, [api]);
  const [loaded, reload] = useLoad(load);
  const [config, setConfigState] = useState<ConfigValues | null>(null);
  const [threshold, setThreshold] = useState("");
  const { run, view } = useFeedback();

  useEffect(() => {
    if (loaded.state === "ready") {
      setConfigState(loaded.value.config);
      setThreshold(loaded.value.config?.values["fallback.threshold"] ?? "");
    }
  }, [loaded]);

  const save = (key: string, value: string) =>
    run(async () => {
      const next = await setConfig(api, key, value);
      setConfigState(next);
      return "Saved " + key + " in " + next.path;
    });
  const hooks = async (harness: string, install: boolean) => {
    if (
      await run(async () => {
        const setup = await setHooks(api, harness, install);
        if (setup.err) {
          throw new Error(setup.err);
        }
        return install ? "Hooks installed in " + setup.file : setup.backup ? "Hooks removed. Backup: " + setup.backup : "Hooks removed";
      })
    ) {
      reload();
    }
  };
  const nvim = async () => {
    if (await run(async () => (await setUpNvim(api), "nvim plugin set up"))) {
      reload();
    }
  };

  if (loaded.state !== "ready") {
    return <Group title="Agents">{loaded.state === "failed" ? <Note text={loaded.note} /> : null}</Group>;
  }
  const { harnesses, onboarding, configNote } = loaded.value;
  const value = (key: string) => config?.values[key] ?? "";
  return (
    <Group title="Agents">
      {configNote ? <Note text={configNote} /> : null}
      {harnesses.map((h) => {
        const setup = onboarding.harnesses[h.harness];
        return (
          <fieldset key={h.harness} className="agent-settings">
            <legend>{harnessName(h)}</legend>
            <p className="muted">{setup?.installed ? "Hooks installed in " + setup.file : "Hooks not installed"}</p>
            <div className="settings-actions">
              {setup?.installed ? (
                <button type="button" className="secondary" onClick={() => hooks(h.harness, false)}>
                  Remove hooks
                </button>
              ) : (
                <button type="button" onClick={() => hooks(h.harness, true)}>
                  Install hooks
                </button>
              )}
            </div>
            {config ? (
              <>
                <div className="ui-field">
                  Default model
                  <Select
                    label="Default model"
                    value={value("defaults." + h.harness + ".model")}
                    onChange={(v) => save("defaults." + h.harness + ".model", v)}
                    options={[{ value: "", label: "default" + (h.default_model ? " (" + h.default_model + ")" : "") }, ...(h.models ?? []).map((m) => ({ value: m, label: m }))]}
                  />
                </div>
                <div className="ui-field">
                  Default effort
                  <Select
                    label="Default effort"
                    value={value("defaults." + h.harness + ".effort")}
                    onChange={(v) => save("defaults." + h.harness + ".effort", v)}
                    options={[{ value: "", label: "default" + (h.default_effort ? " (" + h.default_effort + ")" : "") }, ...(h.efforts ?? []).map((m) => ({ value: m, label: m }))]}
                  />
                </div>
              </>
            ) : null}
          </fieldset>
        );
      })}
      {config ? (
        <div className="settings-row">
          <div className="ui-field">
            Fallback threshold (%)
            <Stepper label="Fallback threshold (%)" min={0} max={100} value={threshold} onChange={setThreshold} />
          </div>
          <button type="button" onClick={() => save("fallback.threshold", threshold)}>
            Save threshold
          </button>
        </div>
      ) : null}
      <p className="muted">
        {onboarding.nvim.configured
          ? "nvim is set up in " + onboarding.nvim.config_file
          : onboarding.nvim.on_path
            ? "nvim is not set up for crew"
            : "nvim is not installed on the server"}
      </p>
      {onboarding.nvim.on_path && !onboarding.nvim.configured ? (
        <button type="button" onClick={nvim}>
          Set up nvim
        </button>
      ) : null}
      {view}
    </Group>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function ServerNotificationsGroup({ api, self }: { api: Authed; self: string }) {
  const loadConfig = useCallback(() => getConfig(api), [api]);
  const loadDevices = useCallback(() => listDevices(api), [api]);
  const [config] = useLoad(loadConfig);
  const [devices, reloadDevices] = useLoad(loadDevices);
  const [away, setAway] = useState("");
  const [revoking, setRevoking] = useState("");
  const [code, setCode] = useState<PairCode | null>(null);
  const delay = useFeedback();
  const { run, view } = useFeedback();

  useEffect(() => {
    if (config.state === "ready") {
      setAway(config.value.values["push.away_after"] ?? "");
    }
  }, [config]);

  const revoke = async (d: Device) => {
    if (await run(async () => (await revokeDevice(api, d.id), "Revoked " + d.name))) {
      setRevoking("");
      reloadDevices();
    }
  };

  return (
    <Group title="Notifications">
      {config.state === "failed" ? <Note text={config.note} /> : null}
      {config.state === "ready" ? (
        <div className="settings-row">
          <label>
            Push after I am away for
            <input type="text" value={away} placeholder="2m" onChange={(e) => setAway(e.target.value)} />
          </label>
          <button type="button" onClick={() => delay.run(async () => "Saved push.away_after in " + (await setConfig(api, "push.away_after", away)).path)}>
            Save delay
          </button>
        </div>
      ) : null}
      {delay.view}
      <h3>Devices</h3>
      {devices.state === "failed" ? <Note text={devices.note} /> : null}
      {devices.state === "ready" ? (
        <ul className="settings-list">
          {devices.value.devices.map((d) => (
            <li key={d.id} aria-label={d.name}>
              <span>{d.name}</span>
              <span className="muted">{d.id === self ? "This device" : "Last seen " + when(d.last_seen)}</span>
              {d.id === self ? null : revoking === d.id ? (
                <button type="button" className="secondary" onClick={() => revoke(d)}>
                  {"Revoke " + d.name}
                </button>
              ) : (
                <button type="button" className="secondary" onClick={() => setRevoking(d.id)}>
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {devices.state === "failed" ? null : (
        <button type="button" onClick={() => run(async () => (setCode(await newPairCode(api)), ""))}>
          Pair a device
        </button>
      )}
      {code ? (
        <p className="pair-code">
          Enter <code>{code.code}</code> in the app on the new device. The code expires at {when(code.expires_at)}.
        </p>
      ) : null}
      {view}
    </Group>
  );
}

export const themeKeys = ["text", "subtext", "overlay", "surface", "mantle", "base", "blue", "peach", "green", "red", "teal", "mauve", "selected", "added_bg", "deleted_bg"];

export function ServerAppearanceGroup({ api }: { api: Authed }) {
  const loadConfig = useCallback(() => getConfig(api), [api]);
  const [config] = useLoad(loadConfig);
  const [colors, setColors] = useState<Record<string, string>>({});
  const { run, view } = useFeedback();

  useEffect(() => {
    if (config.state === "ready") {
      setColors(Object.fromEntries(themeKeys.map((k) => [k, config.value.values["theme." + k] ?? ""])));
    }
  }, [config]);

  return (
    <Group title="Appearance">
      <p className="muted">The [theme] colours of the TUI on the server. Leave a field empty to use the default.</p>
      {config.state === "failed" ? <Note text={config.note} /> : null}
      {config.state === "ready" ? (
        <ul className="settings-list theme-colors">
          {themeKeys.map((k) => (
            <li key={k}>
              <span className="swatch" style={{ background: colors[k] || "transparent" }} aria-hidden="true" />
              <label>
                {k}
                <input type="text" value={colors[k] ?? ""} placeholder="#rrggbb" onChange={(e) => setColors({ ...colors, [k]: e.target.value })} />
              </label>
              <button type="button" aria-label={"Save " + k} onClick={() => run(async () => "Saved theme." + k + " in " + (await setConfig(api, "theme." + k, colors[k] ?? "")).path)}>
                Save
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {view}
    </Group>
  );
}
