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
import { Button, Dialog, Menu, Select, Stepper } from "../ui";
import { Group, Opt, ServerTag } from "./SettingsRows";
import { BrowseButton, type PickFolder } from "./BrowseButton";

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

function Heading({ title, server, children }: { title: string; server?: boolean; children?: ReactNode }) {
  return (
    <h2 className="set-title">
      {title}
      {server ? <ServerTag /> : null}
      <span className="spacer" />
      {children}
    </h2>
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

function RowMenu({ label, items, onPick }: { label: string; items: { value: string; label: string }[]; onPick: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="ui-anchor">
      <Button variant="icon" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        ⋯
      </Button>
      {open ? (
        <Menu
          label={label}
          items={items}
          className="row-menu"
          onClose={() => setOpen(false)}
          onPick={(v) => {
            setOpen(false);
            onPick(v);
          }}
        />
      ) : null}
    </span>
  );
}

function Confirm({ title, action, onConfirm, onClose }: { title: string; action: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="dialog-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm}>
          {action}
        </Button>
      </div>
    </Dialog>
  );
}

export function WorkspacesGroup({ api, pickFolder }: { api: Authed; pickFolder?: PickFolder }) {
  const load = useCallback(async () => {
    const [list, options] = await Promise.all([listWorkspaces(api.fetch, api.token), sessionOptions(api.fetch, api.token).catch(() => ({ home: "" }))]);
    return { list, home: options.home ?? "" };
  }, [api]);
  const [loaded, reload] = useLoad(load);
  const [adding, setAdding] = useState(false);
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
      setAdding(false);
      reload();
    }
  };
  const remove = async (root: string) => {
    setRemoving("");
    if (await run(async () => (await removeWorkspace(api.fetch, api.token, root), "Removed " + root))) {
      reload();
    }
  };

  return (
    <>
      <Heading title="Workspaces" server>
        <Button variant="primary" className="sm" onClick={() => setAdding(!adding)}>
          Add a folder…
        </Button>
      </Heading>
      {loaded.state === "failed" ? <Note text={loaded.note} /> : null}
      {adding ? (
        <div className="path-field">
          <label htmlFor="workspace-path" className="visually-hidden">
            Workspace path
          </label>
          <input
            id="workspace-path"
            className="ui input"
            role="combobox"
            aria-expanded={shown.length > 0}
            aria-controls="workspace-folders"
            aria-autocomplete="list"
            autoComplete="off"
            autoFocus
            placeholder="~/code/api"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && text.trim() && add()}
          />
          {pickFolder ? <BrowseButton pick={pickFolder} onPick={setText} /> : null}
          <Button variant="primary" disabled={!text.trim()} onClick={add}>
            Add workspace
          </Button>
          {shown.length > 0 ? (
            <ul id="workspace-folders" role="listbox" aria-label="Folders" className="ui menu folders">
              {shown.map((f) => (
                <li key={f} className="item" role="option" aria-selected={false} tabIndex={-1} onClick={() => setText(f)} onKeyDown={(e) => e.key === "Enter" && setText(f)}>
                  {f}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {loaded.state === "ready" && known.length === 0 ? <p className="set-lead">No workspaces yet. Add a folder to start sessions in it.</p> : null}
      {loaded.state === "ready" && known.length > 0 ? (
        <ul className="group" aria-label="Workspaces">
          {known.map((w: WorkspaceInfo) => (
            <li key={w.Root} className="opt" aria-label={w.Root}>
              <span className="mono grow">{w.Root}</span>
              <span className="muted">{w.Kind === "orchestration" ? "orchestration root" : "git repo"}</span>
              <RowMenu label={"More for " + w.Root} items={[{ value: "remove", label: "Remove" }]} onPick={() => setRemoving(w.Root)} />
            </li>
          ))}
        </ul>
      ) : null}
      {view}
      {removing ? <Confirm title={"Remove " + removing + "?"} action="Remove" onClose={() => setRemoving("")} onConfirm={() => remove(removing)} /> : null}
    </>
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
    return (
      <>
        <Heading title="Agents" server />
        {loaded.state === "failed" ? <Note text={loaded.note} /> : null}
      </>
    );
  }
  const { harnesses, onboarding, configNote } = loaded.value;
  const value = (key: string) => config?.values[key] ?? "";
  return (
    <>
      <Heading title="Agents" server />
      {configNote ? <Note text={configNote} /> : null}
      {harnesses.map((h) => {
        const setup = onboarding.harnesses[h.harness];
        return (
          <section key={h.harness} className="set-section" role="group" aria-label={harnessName(h)}>
            <div className="gtitle">{harnessName(h).toUpperCase()}</div>
            <div className="group">
              <Opt lead={<span className={"dot" + (setup?.installed ? " ok" : "")} />} title="Hooks" sub={setup?.installed ? "Hooks installed in " + setup.file : "Hooks not installed"}>
                {setup?.installed ? (
                  <Button className="sm" onClick={() => hooks(h.harness, false)}>
                    Remove hooks
                  </Button>
                ) : (
                  <Button variant="primary" className="sm" onClick={() => hooks(h.harness, true)}>
                    Install hooks
                  </Button>
                )}
              </Opt>
              {config ? (
                <>
                  <Opt title="Default model">
                    <Select
                      label="Default model"
                      value={value("defaults." + h.harness + ".model")}
                      onChange={(v) => save("defaults." + h.harness + ".model", v)}
                      options={[{ value: "", label: "default" + (h.default_model ? " (" + h.default_model + ")" : "") }, ...(h.models ?? []).map((m) => ({ value: m, label: m }))]}
                    />
                  </Opt>
                  <Opt title="Default effort">
                    <Select
                      label="Default effort"
                      value={value("defaults." + h.harness + ".effort")}
                      onChange={(v) => save("defaults." + h.harness + ".effort", v)}
                      options={[{ value: "", label: "default" + (h.default_effort ? " (" + h.default_effort + ")" : "") }, ...(h.efforts ?? []).map((m) => ({ value: m, label: m }))]}
                    />
                  </Opt>
                </>
              ) : null}
            </div>
          </section>
        );
      })}
      <Group label="Options" title="OPTIONS">
        {config ? (
          <Opt title="Fallback threshold (%)" sub="Switch to the fallback agent at this limit use">
            <Stepper label="Fallback threshold (%)" min={0} max={100} value={threshold} onChange={setThreshold} />
            <Button className="sm" onClick={() => save("fallback.threshold", threshold)}>
              Save threshold
            </Button>
          </Opt>
        ) : null}
        <Opt
          lead={<span className={"dot" + (onboarding.nvim.configured ? " ok" : "")} />}
          title="nvim"
          sub={
            onboarding.nvim.configured
              ? "nvim is set up in " + onboarding.nvim.config_file
              : onboarding.nvim.on_path
                ? "nvim is not set up for crew"
                : "nvim is not installed on the server"
          }
        >
          {onboarding.nvim.on_path && !onboarding.nvim.configured ? (
            <Button className="sm" onClick={nvim}>
              Set up nvim
            </Button>
          ) : null}
        </Opt>
      </Group>
      {view}
    </>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

const awayChoices: [string, string][] = [
  ["1m", "1 min"],
  ["2m", "2 min"],
  ["5m", "5 min"],
  ["10m", "10 min"],
  ["30m", "30 min"],
];

export function PushDelayRow({ api }: { api: Authed }) {
  const loadConfig = useCallback(() => getConfig(api), [api]);
  const [config] = useLoad(loadConfig);
  const [away, setAway] = useState("");
  const { run, view } = useFeedback();

  useEffect(() => {
    if (config.state === "ready") {
      setAway(config.value.values["push.away_after"] ?? "");
    }
  }, [config]);

  const options = awayChoices.map(([value, label]) => ({ value, label }));
  if (away && !awayChoices.some(([v]) => v === away)) {
    options.push({ value: away, label: away });
  }
  return (
    <>
      <Opt title="Push to my phone after I'm away for" server sub={config.state === "failed" ? config.note : undefined}>
        {config.state === "ready" ? (
          <Select
            label="Push to my phone after I'm away for"
            value={away}
            placeholder="default"
            options={options}
            onChange={(v) => {
              setAway(v);
              run(async () => "Saved push.away_after in " + (await setConfig(api, "push.away_after", v)).path);
            }}
          />
        ) : null}
      </Opt>
      {view}
    </>
  );
}

export function DevicesGroup({ api, self }: { api: Authed; self: string }) {
  const loadDevices = useCallback(() => listDevices(api), [api]);
  const [devices, reloadDevices] = useLoad(loadDevices);
  const [revoking, setRevoking] = useState<Device | null>(null);
  const [code, setCode] = useState<PairCode | null>(null);
  const { run, view } = useFeedback();

  const revoke = async (d: Device) => {
    setRevoking(null);
    if (await run(async () => (await revokeDevice(api, d.id), "Revoked " + d.name))) {
      reloadDevices();
    }
  };

  return (
    <>
      <Heading title="Devices" server>
        {devices.state === "failed" ? null : (
          <Button variant="primary" className="sm" onClick={() => run(async () => (setCode(await newPairCode(api)), ""))}>
            Pair a device
          </Button>
        )}
      </Heading>
      {devices.state === "failed" ? <Note text={devices.note} /> : null}
      {code ? (
        <p className="pair-code">
          Enter <code>{code.code}</code> in the app on the new device. The code expires at {when(code.expires_at)}.
        </p>
      ) : null}
      {devices.state === "ready" ? (
        <ul className="group" aria-label="Devices">
          {devices.value.devices.map((d) => (
            <li key={d.id} className="opt" aria-label={d.name}>
              <div className="l">
                <div className="t">{d.name}</div>
                <div className="s">{d.id === self ? "This device" : "Last seen " + when(d.last_seen)}</div>
              </div>
              {d.id === self ? null : (
                <Button className="sm" onClick={() => setRevoking(d)}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {view}
      {revoking ? <Confirm title={"Revoke " + revoking.name + "?"} action="Revoke" onClose={() => setRevoking(null)} onConfirm={() => revoke(revoking)} /> : null}
    </>
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
    <section className="set-section" aria-label="TUI colors">
      <div className="gtitle">
        TUI COLORS <ServerTag />
      </div>
      {config.state === "failed" ? <Note text={config.note} /> : null}
      {config.state === "ready" ? (
        <div className="group">
          <Opt sub="The [theme] colours of the TUI on the server. Leave a field empty to use the default." />
          {themeKeys.map((k) => (
            <Opt key={k} lead={<span className="swatch" style={{ background: colors[k] || "transparent" }} aria-hidden="true" />} title={k}>
              <input className="ui input color-input" aria-label={k} type="text" value={colors[k] ?? ""} placeholder="#rrggbb" onChange={(e) => setColors({ ...colors, [k]: e.target.value })} />
              <Button className="sm" aria-label={"Save " + k} onClick={() => run(async () => "Saved theme." + k + " in " + (await setConfig(api, "theme." + k, colors[k] ?? "")).path)}>
                Save
              </Button>
            </Opt>
          ))}
        </div>
      ) : null}
      {view}
    </section>
  );
}
