import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { DesktopBridge } from "../desktopBridge";
import { Servers, sshTarget } from "../servers";
import {
  desktopMachines,
  loadHub,
  notReachable,
  pairedMachines,
  type Hub,
  type MachineLink,
  type MachineState,
} from "../machines";
import {
  type Authed,
  createEnv,
  deleteEnv,
  type EnvInfo,
  type EnvLocal,
  envSSHKey,
  getEnv,
  listEnvs,
  setEnv,
  unsetEnvSecret,
} from "../api";
import {
  accountRows,
  customParts,
  envOrder,
  extraSecrets,
  identitySub,
  isLocal,
  machineAddress,
  machineTitle,
  machineWhere,
  matesText,
  secretSet,
  usedLabel,
} from "../envs";
import { Button, Dialog, Menu, Select } from "../ui";
import { MateFace } from "./Mates";
import { HooksBanner } from "./HooksBanner";
import { CopyIdentity } from "./CopyIdentity";

type Props = { api: Authed; route: string; wide: boolean; desktop?: DesktopBridge };

type Place = { title: string; where: string; key: string };

const PlaceContext = createContext<Place>({ title: "This Mac", where: "this Mac", key: "" });

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useEnvs(api: Authed): {
  envs: EnvInfo[];
  error: string;
  reload: () => void;
} {
  const [envs, setEnvs] = useState<EnvInfo[]>([]);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let on = true;
    listEnvs(api)
      .then((out) => {
        if (on) {
          setEnvs(envOrder(out.envs));
          setError("");
        }
      })
      .catch((err) => on && setError(message(err)));
    return () => {
      on = false;
    };
  }, [api, tick]);
  return { envs, error, reload: useCallback(() => setTick((n) => n + 1), []) };
}


function safe(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

function machineHref(key: string): string {
  return "#/envs/" + encodeURIComponent(key);
}

function identityHref(key: string, name: string): string {
  return machineHref(key) + "/" + encodeURIComponent(name);
}

function machineIcon(m: MachineState): string {
  return m.local ? "⌘" : "▣";
}

function machineSub(m: MachineState): string {
  if (m.local) {
    return "crew runs here";
  }
  const address = machineAddress(m.key);
  if (m.key.startsWith("ssh:")) {
    return "SSH · " + (m.state === "down" ? "not reachable" : address);
  }
  return m.state === "down" ? "not reachable" : "paired";
}

function machineStatus(m: MachineState): string {
  if (m.state === "down") {
    return "not reachable";
  }
  return m.key.startsWith("ssh:") ? "SSH · connected" : "connected";
}

const unusedYours: EnvInfo = { name: "yours", kind: "local", parts: [], secrets: [], used_by: [] };

function identitiesOf(hub: Hub, m: MachineState): EnvInfo[] {
  const list = hub.environments.filter((e) => e.key === m.key).map((e) => e.item);
  return list.length === 0 ? [unusedYours] : envOrder(list);
}

function IdentityIcon({ env, small }: { env: EnvInfo; small?: boolean }) {
  return (
    <span className={"eicon " + (env.kind === "local" ? "y" : "c") + (small ? " sm" : "")} aria-hidden="true">
      {env.kind === "local" ? "Y" : env.name.charAt(0).toUpperCase()}
    </span>
  );
}

function identityTitle(env: EnvInfo): string {
  return env.kind === "local" ? "Your accounts" : env.name;
}

function EnvList({
  hub,
  selected,
  onMachine,
}: {
  hub: Hub;
  selected: { key: string; name: string };
  onMachine?: () => void;
}) {
  return (
    <div className="elist">
      <div className="elist-head">
        <span className="elist-title">Environments</span>
        <span className="spacer" />
        {onMachine ? (
          <Button className="sm" onClick={onMachine}>
            + Machine
          </Button>
        ) : null}
      </div>
      <ul className="side-scroll elist-rows" aria-label="Environments">
        {hub.machines.flatMap((m) => {
          const on = selected.key === m.key && selected.name === "";
          return [
            <li key={m.key}>
              <a className={"mrow-d" + (on ? " on" : "")} href={machineHref(m.key)} aria-current={on ? "page" : undefined}>
                <span className="eicon m" aria-hidden="true">
                  {machineIcon(m)}
                </span>
                <div className="nm">
                  <div>{machineTitle(m.local, m.name)}</div>
                  <div className="s">{machineSub(m)}</div>
                </div>
                <span className={"dot " + (m.state === "up" ? "ok" : "bad")} />
              </a>
            </li>,
            ...identitiesOf(hub, m).map((e) => {
              const here = selected.key === m.key && selected.name !== "" && (selected.name === e.name || (isLocal(e) && (selected.name === "local" || selected.name === "yours")));
              return (
                <li key={m.key + "/" + e.name}>
                  <a className={"row irow" + (here ? " on" : "")} href={identityHref(m.key, e.name)} aria-current={here ? "page" : undefined}>
                    <IdentityIcon env={e} />
                    <div className="nm">
                      <div>{identityTitle(e)}</div>
                      <div className="s">{identitySub(e)}</div>
                    </div>
                  </a>
                </li>
              );
            }),
          ];
        })}
      </ul>
      <div className="elist-foot muted">An environment is a machine and the accounts a mate uses on it.</div>
    </div>
  );
}

function PhoneList({ hub, onNew }: { hub: Hub; onNew?: () => void }) {
  return (
    <div className="pbody">
      <div className="page-head envs-phone-head">
        <h2>Environments</h2>
        <span className="spacer" />
        {onNew ? (
          <Button variant="icon" aria-label="+ Machine" onClick={onNew}>
            +
          </Button>
        ) : null}
      </div>
      {hub.machines.map((m) => (
        <div key={m.key} className="pgrp" role="group" aria-label={machineTitle(m.local, m.name)}>
          <a className="pgh" href={machineHref(m.key)}>
            <span className={"dot " + (m.state === "up" ? "ok" : "bad")} />
            <b>{machineTitle(m.local, m.name)}</b>
            <span className="muted">{machineStatus(m)}</span>
            <span className="spacer" />
            <span className="muted">›</span>
          </a>
          {identitiesOf(hub, m).map((e) => (
            <a key={e.name} className="mrow" href={identityHref(m.key, e.name)}>
              <IdentityIcon env={e} />
              <div className="g">
                <div className="t">{identityTitle(e)}</div>
                <div className="s">{identitySub(e)}</div>
              </div>
              <span className="muted">›</span>
            </a>
          ))}
        </div>
      ))}
      <div className="muted envs-phone-foot">An environment is a machine and the accounts a mate uses on it.</div>
    </div>
  );
}

type Contact = { build: string; ms: number } | null;

function useContact(link: MachineLink | undefined, up: boolean, tick: number): Contact {
  const [contact, setContact] = useState<Contact>(null);
  useEffect(() => {
    setContact(null);
    if (!link || !up) {
      return;
    }
    let on = true;
    const start = Date.now();
    link
      .fetch("/api/v1/hello", { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json()) as { build?: string };
        if (on) {
          setContact({ build: body.build ?? "", ms: Date.now() - start });
        }
      })
      .catch(() => undefined);
    return () => {
      on = false;
    };
  }, [link, up, tick]);
  return contact;
}

function hostName(target: string): string {
  return target.replace(/^.*@/, "").split(".")[0];
}

function ConnectDialog({ servers, onClose, onDone }: { servers: Servers; onClose: () => void; onDone: (id: string) => void }) {
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [steps, setSteps] = useState<string[]>([]);
  const [looking, setLooking] = useState("");
  const connect = async () => {
    const target = sshTarget(address);
    setError("");
    setSteps([]);
    setLooking("");
    if (!target) {
      setError("Type a host name, not ssh options.");
      return;
    }
    setBusy(true);
    try {
      const remote = await servers.crew(target);
      setSteps(["Connected over SSH"]);
      if (remote.action !== "current") {
        await servers.install(target);
      }
      const version = remote.action === "current" ? (remote.server ?? remote.app) : remote.app;
      setSteps(["Connected over SSH", "crew " + version + " installed and running"]);
      setLooking("Looking for your logins on " + hostName(target) + "…");
      const id = await servers.add("ssh", target);
      onDone(id);
    } catch (err) {
      setError(message(err));
      setLooking("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Connect a server" onClose={onClose} className="connect-server">
      <p>crew connects over SSH and installs its own crew there. The server becomes a machine in Environments, with your accounts on it.</p>
      <div className="fld">
        <label htmlFor="connect-ssh">SSH address</label>
        <input
          id="connect-ssh"
          className="ui input mono"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="giovani@devbox.tail.ts.net"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {steps.length > 0 || looking ? (
        <div className="steplist">
          {steps.map((t) => (
            <div key={t}>
              <span className="set-y">{t}</span>
            </div>
          ))}
          {looking ? (
            <div>
              <span className="dot run" /> {looking}
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="dialog-actions">
        <Button variant="quiet" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={busy || address.trim() === ""} onClick={() => void connect()}>
          Connect
        </Button>
      </div>
    </Dialog>
  );
}

function DisconnectDialog({ title, onClose, onConfirm }: { title: string; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const go = () => {
    setBusy(true);
    onConfirm()
      .catch((err) => setError(message(err)))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog title={"Disconnect " + title + "?"} onClose={onClose}>
      <p>
        crew forgets this machine and its login on this Mac. crew on {title} keeps running, and its mates and identities stay there.
      </p>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="dialog-actions">
        <Button variant="quiet" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" disabled={busy} onClick={go}>
          Disconnect
        </Button>
      </div>
    </Dialog>
  );
}

function MachineMenu({ fix, onFix, onDisconnect }: { fix: boolean; onFix: () => void; onDisconnect: () => void }) {
  const [open, setOpen] = useState(false);
  const items = [...(fix ? [{ value: "fix", label: "Fix" }] : []), { value: "disconnect", label: "Disconnect…" }];
  return (
    <span className="ui-anchor">
      <Button variant="icon" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        ⋯
      </Button>
      {open ? (
        <Menu
          label="Machine"
          className="menu-right"
          items={items}
          onPick={(v) => {
            setOpen(false);
            if (v === "fix") {
              onFix();
            } else {
              onDisconnect();
            }
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </span>
  );
}

function MachineDetail({
  m,
  link,
  hub,
  wide,
  onNew,
  servers,
  onGone,
}: {
  m: MachineState;
  link: MachineLink | undefined;
  hub: Hub;
  wide: boolean;
  onNew: () => void;
  servers?: Servers;
  onGone: () => void;
}) {
  const [tick, setTick] = useState(0);
  const [disconnecting, setDisconnecting] = useState(false);
  const [fixNote, setFixNote] = useState("");
  const managed = servers && !m.local ? servers : undefined;
  const fix = () => {
    if (!managed) {
      return;
    }
    setFixNote("");
    managed
      .fix(m.key)
      .then(() => {
        setFixNote("Fixed");
        setTick((n) => n + 1);
      })
      .catch((err) => setFixNote(message(err)));
  };
  const disconnect = managed ? (
    <>
      <div className="eactions">
        <Button variant="quiet" className="danger" onClick={() => setDisconnecting(true)}>
          {"Disconnect " + machineTitle(m.local, m.name) + "…"}
        </Button>
      </div>
      {fixNote ? (
        <p className={fixNote === "Fixed" ? "muted small" : "error"} role={fixNote === "Fixed" ? "status" : "alert"}>
          {fixNote}
        </p>
      ) : null}
      {disconnecting ? (
        <DisconnectDialog
          title={machineTitle(m.local, m.name)}
          onClose={() => setDisconnecting(false)}
          onConfirm={async () => {
            await managed.remove(m.key);
            setDisconnecting(false);
            onGone();
          }}
        />
      ) : null}
    </>
  ) : null;
  const contact = useContact(link, m.state === "up", tick);
  const title = machineTitle(m.local, m.name);
  const where = machineWhere(m.local, m.name);
  const address = machineAddress(m.key);
  const separate = identitiesOf(hub, m).filter((e) => e.kind !== "local");
  const up = m.state === "up";
  const pill = up ? <span className="pill ok">connected</span> : <span className="pill bad">not reachable</span>;
  const crew = (
    <span className={up ? "set-y" : "set-n"}>
      {up ? (wide && contact?.build ? "running · " + contact.build : "running") : notReachable}
    </span>
  );
  const found = (m.found ? foundRows(m.found, m.local ? "" : where) : []).filter((r) => wide || (r.label !== "Git identity" && r.label !== "SSH"));
  if (!wide) {
    return (
      <div className="eedit mdetail">
        <div className="page-head">
          <a className="ui icon-btn" href="#/envs" aria-label="Back">
            ‹
          </a>
          <span className="eicon m" aria-hidden="true">
            {machineIcon(m)}
          </span>
          <h2>{title}</h2>
          <span className="spacer" />
          {pill}
        </div>
        <div className="kv">
          <h4>CONNECTION</h4>
          {address ? (
            <div className="r" role="group" aria-label="Address">
              <span className="k">Address</span>
              <span className="mono dim small">{address}</span>
            </div>
          ) : null}
          <div className="r" role="group" aria-label={"crew on " + where}>
            <span className="k">{"crew on " + where}</span>
            {crew}
          </div>
        </div>
        {up ? (
          <div className="kv">
            <h4>{"YOUR ACCOUNTS ON " + where.toUpperCase()}</h4>
            {found.map((r) => (
              <div key={r.label} className="r" role="group" aria-label={r.label}>
                <span className="k">{r.label}</span>
                <span className={r.ok ? "set-y" : "set-n"}>{r.text}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="kv">
          <h4>SEPARATE IDENTITIES</h4>
          {separate.map((e) => (
            <a key={e.name} className="r" href={identityHref(m.key, e.name)}>
              <span>{e.name + (e.used_by.length > 0 ? " · " + e.used_by.join(", ") : "")}</span>
              <span className="muted">›</span>
            </a>
          ))}
          {up ? (
            <Button className="kv-btn" onClick={onNew}>
              + Separate identity
            </Button>
          ) : null}
        </div>
        {disconnect}
      </div>
    );
  }
  return (
    <div className="eedit">
      <div className="page-head">
        <span className="eicon m" aria-hidden="true">
          {machineIcon(m)}
        </span>
        <h2>{title}</h2>
        {pill}
        <span className="spacer" />
        {up ? (
          <Button className="sm" onClick={onNew}>
            + Separate identity
          </Button>
        ) : null}
        {managed ? <MachineMenu fix={m.key.startsWith("ssh:")} onFix={fix} onDisconnect={() => setDisconnecting(true)} /> : null}
      </div>
      <p className="dim lead">
        {m.local
          ? "The computer that runs this app. Its own crew runs here, so mates on this Mac stop when this Mac sleeps."
          : m.key.startsWith("ssh:")
            ? "A server that you connected over SSH. Its own crew runs there, so mates on " + where + " keep working when this Mac sleeps."
            : "A server where its own crew runs, so mates on " + where + " keep working when this device sleeps."}
      </p>
      <div className="gtitle">CONNECTION</div>
      <div className="group">
        {address ? (
          <Opt label="Address" title="Address">
            <span className="mono dim">{address}</span>
          </Opt>
        ) : null}
        <Opt label={"crew on " + where} title={"crew on " + where}>
          {crew}
        </Opt>
        <Opt label="Last contact" title="Last contact">
          <span className="dim">{up ? (contact ? "now · " + contact.ms + " ms" : "now") : notReachable}</span>
          <Button variant="quiet" className="sm" onClick={() => setTick((n) => n + 1)}>
            Test
          </Button>
        </Opt>
      </div>
      {up ? (
        <>
          <div className="gtitle">
            {"YOUR ACCOUNTS ON " + where.toUpperCase()}
            <span className="spacer" />
            <span className="muted gnote">crew reads these and does not change them</span>
          </div>
          <div className="group">
            {found.map((r) => (
              <Opt key={r.label} label={r.label} title={r.label}>
                <span className={r.ok ? "set-y" : "set-n"}>{r.text}</span>
                {!r.ok && r.how ? <HowTo>{r.how}</HowTo> : null}
              </Opt>
            ))}
          </div>
          <div className="gtitle">{"SEPARATE IDENTITIES ON " + where.toUpperCase()}</div>
          <div className="group">
            {separate.length > 0 ? (
              separate.map((e) => (
                <a key={e.name} className="opt" href={identityHref(m.key, e.name)}>
                  <IdentityIcon env={e} small />
                  <div className="l">
                    <div className="t">{e.name}</div>
                    <div className="s">{"Own git name, SSH key and tokens" + (e.used_by.length > 0 ? " · " + e.used_by.join(", ") : "")}</div>
                  </div>
                  <span className="muted">›</span>
                </a>
              ))
            ) : (
              <div className="opt">
                <span className="muted">No separate identity yet.</span>
              </div>
            )}
          </div>
        </>
      ) : null}
      {disconnect}
    </div>
  );
}

type SecretAsk = { title: string; keys: string[]; label: string };

function SecretDialog({
  api,
  env,
  ask,
  onClose,
  onSaved,
}: {
  api: Authed;
  env: EnvInfo;
  ask: SecretAsk;
  onClose: () => void;
  onSaved: (e: EnvInfo) => void;
}) {
  const [key, setKey] = useState(ask.keys[0]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const custom = ask.keys.length === 0;
  const save = () => {
    const secret = custom ? name.trim() : key;
    setBusy(true);
    setError("");
    setEnv(api, env.name, { secret, value })
      .then((out) => {
        setValue("");
        onSaved(out);
      })
      .catch((err) => {
        setValue("");
        setError(message(err));
      })
      .finally(() => setBusy(false));
  };
  return (
    <Dialog title={ask.title} onClose={onClose}>
      <p>
        Paste the {ask.label}. crew stores it for the <b>{env.name}</b>{" "}
        environment and does not show it again.
      </p>
      {custom ? (
        <label className="field">
          <span>Variable</span>
          <input
            className="ui input mono"
            value={name}
            onChange={(e) => setName(e.target.value.toUpperCase())}
            placeholder="LINEAR_API_KEY"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      ) : null}
      {ask.keys.length > 1 ? (
        <Select
          label="Provider key"
          value={key}
          options={ask.keys.map((k) => ({ value: k, label: k }))}
          onChange={setKey}
        />
      ) : null}
      <label className="field">
        <input
          className="ui input mono"
          type="password"
          aria-label="Value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="new-password"
          spellCheck={false}
        />
      </label>
      <div className="muted dialog-note">
        {env.used_by.length > 0
          ? matesText(env.used_by) + " use it from their next conversation."
          : "Mates use it from their next conversation."}
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="dialog-actions">
        <Button variant="quiet" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={busy || value === "" || (custom && name.trim() === "")}
          onClick={save}
        >
          {custom ? "Save variable" : "Save key"}
        </Button>
      </div>
    </Dialog>
  );
}

function SecretState({ set }: { set: boolean }) {
  return set ? (
    <span className="set-y">set</span>
  ) : (
    <span className="set-n">not set</span>
  );
}

function SecretButtons({
  set,
  onSet,
  onRemove,
  removeIcon,
}: {
  set: boolean;
  onSet: () => void;
  onRemove?: () => void;
  removeIcon?: boolean;
}) {
  return (
    <span className="secret">
      <SecretState set={set} />
      {set ? (
        <Button variant="quiet" className="sm" onClick={onSet}>
          Replace
        </Button>
      ) : (
        <Button className="sm" onClick={onSet}>
          Set…
        </Button>
      )}
      {set && onRemove ? (
        removeIcon ? (
          <Button variant="icon" aria-label="Remove" onClick={onRemove}>
            ×
          </Button>
        ) : (
          <Button variant="quiet" className="sm danger" onClick={onRemove}>
            Remove
          </Button>
        )
      ) : null}
    </span>
  );
}

function Opt({
  label,
  title,
  sub,
  children,
}: {
  label: string;
  title?: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="opt" role="group" aria-label={label}>
      {title !== undefined ? (
        <div className="l">
          <div className="t">{title}</div>
          {sub ? <div className="s">{sub}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

function GitIdentity({
  api,
  env,
  onSaved,
}: {
  api: Authed;
  env: EnvInfo;
  onSaved: (e: EnvInfo) => void;
}) {
  const [name, setName] = useState(env.git_name ?? "");
  const [email, setEmail] = useState(env.git_email ?? "");
  const [error, setError] = useState("");
  const saved = useRef((env.git_name ?? "") + "\n" + (env.git_email ?? ""));
  const save = () => {
    const key = name.trim() + "\n" + email.trim();
    if (name.trim() === "" || email.trim() === "" || key === saved.current) {
      return;
    }
    saved.current = key;
    setEnv(api, env.name, { git_name: name.trim(), git_email: email.trim() })
      .then((out) => {
        setError("");
        onSaved(out);
      })
      .catch((err) => setError(message(err)));
  };
  return (
    <>
      <div className="gtitle">GIT NAME</div>
      <div className="group">
        <div className="opt">
          <label className="l t" htmlFor="env-git-name">
            Name
          </label>
          <input
            id="env-git-name"
            className="ui input"
            value={name}
            placeholder="TEST bot"
            onChange={(e) => setName(e.target.value)}
            onBlur={save}
          />
        </div>
        <div className="opt">
          <label className="l t" htmlFor="env-git-email">
            Email
          </label>
          <input
            id="env-git-email"
            className="ui input"
            type="email"
            value={email}
            placeholder="bot@example.com"
            onChange={(e) => setEmail(e.target.value)}
            onBlur={save}
          />
        </div>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </>
  );
}

function shortKey(key: string): string {
  const [kind, body, ...rest] = key.split(" ");
  return (
    kind +
    " …" +
    (body ?? "").slice(-5) +
    (rest.length ? " " + rest.join(" ") : "")
  );
}

function keyDate(at?: string): string {
  if (!at) {
    return "";
  }
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function HowTo({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <span className="dim small howto">{children}</span>
  ) : (
    <Button className="sm" onClick={() => setOpen(true)}>
      How to log in
    </Button>
  );
}

type Found = { label: string; ok: boolean; text: string; how?: ReactNode };

function foundRows(l: EnvLocal | undefined, on = ""): Found[] {
  if (!l) {
    return [];
  }
  const at = on ? " on " + on : "";
  const login = (ok: boolean) => (ok ? "logged in" : "not found");
  return [
    {
      label: "Git identity",
      ok: l.git_name !== "",
      text: l.git_name ? l.git_name + " · from ~/.gitconfig" + at : "not set",
    },
    {
      label: "SSH",
      ok: l.ssh_agent,
      text: l.ssh_agent
        ? "ssh-agent · " + l.ssh_keys + (l.ssh_keys === 1 ? " key" : " keys")
        : l.ssh_keys > 0
          ? l.ssh_keys + (l.ssh_keys === 1 ? " key" : " keys") + " in ~/.ssh" + at
          : "no ssh-agent",
    },
    {
      label: "GitHub CLI",
      ok: l.github,
      text: l.github
        ? l.github_user
          ? "logged in as @" + l.github_user
          : "logged in"
        : "not found",
      how: <span className="mono">gh auth login</span>,
    },
    {
      label: "Claude",
      ok: l.claude,
      text: login(l.claude),
      how: (
        <>
          Run <span className="mono">claude</span>, then type{" "}
          <span className="mono">/login</span>
        </>
      ),
    },
    {
      label: "Codex",
      ok: l.codex,
      text: login(l.codex),
      how: <span className="mono">codex login</span>,
    },
    {
      label: "Pi",
      ok: l.pi,
      text: login(l.pi),
      how: <span className="mono">omp login</span>,
    },
  ];
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

function SSHKey({
  api,
  env,
  onSaved,
}: {
  api: Authed;
  env: EnvInfo;
  onSaved: (e: EnvInfo, changed: boolean) => void;
}) {
  const place = useContext(PlaceContext);
  const [error, setError] = useState("");
  const next = env.new_public_key ?? "";
  const run = (action: "make" | "rotate" | "confirm" | "cancel") => {
    setError("");
    envSSHKey(api, env.name, action)
      .then((out) => onSaved(out, action === "make" || action === "confirm"))
      .catch((err) => setError(message(err)));
  };
  const made = keyDate(env.key_created);
  const alert = error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;
  if (next) {
    return (
      <>
        <div className="gtitle">SSH KEY</div>
        <div className="group">
          <div className="opt keyopt stretch">
            <div className="keyhead">
              <span className="t">New ed25519 key</span>
              <span className="pill warn">waiting for you</span>
              <span className="spacer" />
              <Button className="sm" onClick={() => copy(next)}>
                Copy public key
              </Button>
            </div>
            <div className="keybox">{next}</div>
            <div className="keywarn">
              <span className="dot wait" />
              <div className="kw-body">
                <div className="kw-title">
                  Add the new key to GitHub, then confirm
                </div>
                <div className="dim">
                  The old key stays active until you confirm.{" "}
                  {env.used_by.length > 0
                    ? matesText(env.used_by) + " keep working with it. "
                    : ""}
                  GitHub: Settings › SSH and GPG keys › New SSH key.
                </div>
                <div className="kw-actions">
                  <Button
                    variant="primary"
                    className="sm"
                    onClick={() => run("confirm")}
                  >
                    I added it to GitHub
                  </Button>
                  <Button
                    variant="quiet"
                    className="sm"
                    onClick={() => run("cancel")}
                  >
                    Cancel new key
                  </Button>
                </div>
              </div>
            </div>
            {env.public_key ? (
              <div className="muted small">
                Old key: {shortKey(env.public_key)} · in use until you confirm.
                After you confirm, remove it from GitHub.
              </div>
            ) : null}
            {alert}
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="gtitle">SSH KEY</div>
      <div className="group">
        <div className="opt keyopt">
          <div className="keyhead">
            <span className="t">
              {env.public_key ? "ed25519 key that crew made on " + place.where : "No SSH key yet"}
            </span>
            {env.public_key && made ? (
              <span className="muted small">· {made}</span>
            ) : null}
            <span className="spacer" />
            {env.public_key ? (
              <>
                <Button
                  className="sm"
                  onClick={() => copy(env.public_key ?? "")}
                >
                  Copy public key
                </Button>
                <Button
                  variant="quiet"
                  className="sm"
                  onClick={() => run("rotate")}
                >
                  New key…
                </Button>
              </>
            ) : (
              <Button className="sm" onClick={() => run("make")}>
                Make key
              </Button>
            )}
          </div>
          {env.public_key ? (
            <div className="keybox">{env.public_key}</div>
          ) : null}
          <div className="muted small">
            Add this key to the GitHub account of {env.name}. The private key
            stays on {place.where}.
          </div>
          {alert}
        </div>
      </div>
    </>
  );
}

function UsedBy({ env }: { env: EnvInfo }) {
  if (isLocal(env)) {
    return (
      <>
        <span className="muted small">Used by</span>
        {env.used_by.length > 0 ? (
          <a className="small" href="#/mates">
            {env.used_by.join(", ")}
          </a>
        ) : (
          <span className="small used-names">no mate</span>
        )}
      </>
    );
  }
  return (
    <>
      <span className="muted small">Used by</span>
      {env.used_by.length > 0 ? (
        <>
          <span className="used-faces">
            {env.used_by.slice(0, 3).map((m) => (
              <MateFace key={m} name={m} state="idle" px={20} />
            ))}
          </span>
          <a className="small" href="#/mates" title={env.used_by.join(", ")}>
            {usedLabel(env.used_by.length)}
          </a>
        </>
      ) : (
        <span className="small used-names">no mate</span>
      )}
    </>
  );
}

function MoreMenu({ onDelete, onCopy }: { onDelete: () => void; onCopy: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="ui-anchor">
      <Button
        variant="icon"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </Button>
      {open ? (
        <Menu
          label="Environment"
          className="menu-right"
          items={[{ value: "copy", label: "Copy to another machine…" }, { kind: "sep" as const }, { value: "delete", label: "Delete…" }]}
          onPick={(v) => {
            setOpen(false);
            if (v === "copy") {
              onCopy();
            } else {
              onDelete();
            }
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </span>
  );
}

function DeleteDialog({
  api,
  env,
  onClose,
  onDeleted,
}: {
  api: Authed;
  env: EnvInfo;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const del = () => {
    setBusy(true);
    deleteEnv(api, env.name)
      .then(onDeleted)
      .catch((err) => setError(message(err)))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog title={"Delete " + env.name + "?"} onClose={onClose}>
      <p>
        crew removes the definition, the secrets and the SSH key of this
        environment. A mate must not use it.
      </p>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="dialog-actions">
        <Button variant="quiet" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" disabled={busy} onClick={del}>
          Delete
        </Button>
      </div>
    </Dialog>
  );
}

function Editor({
  api,
  name,
  onChanged,
  onNew,
  back,
}: {
  api: Authed;
  name: string;
  onChanged: () => void;
  onNew: () => void;
  back: boolean;
}) {
  const place = useContext(PlaceContext);
  const [env, setEnvInfo] = useState<EnvInfo | null>(null);
  const [error, setError] = useState("");
  const [changed, setChanged] = useState(false);
  const [ask, setAsk] = useState<SecretAsk | null>(null);
  const [claudeKey, setClaudeKey] = useState("");
  const [codexKey, setCodexKey] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [note, setNote] = useState("");
  const [loads, setLoads] = useState(0);
  useEffect(() => {
    let on = true;
    setEnvInfo(null);
    setChanged(false);
    setClaudeKey("");
    setCodexKey("");
    getEnv(api, name)
      .then((out) => on && (setEnvInfo(out), setError("")))
      .catch((err) => on && setError(message(err)));
    return () => {
      on = false;
    };
  }, [api, name, loads]);
  if (error) {
    return (
      <div className="eedit">
        <p className="error" role="alert">
          {error}
        </p>
      </div>
    );
  }
  if (!env) {
    return <div className="eedit" aria-busy="true" />;
  }
  const saved = (out: EnvInfo, change = true) => {
    setEnvInfo(out);
    if (change) {
      setChanged(true);
      onChanged();
    }
  };
  const unset = (secret: string) => {
    setNote("");
    unsetEnvSecret(api, env.name, secret)
      .then((out) => saved(out))
      .catch((err) => setNote(message(err)));
  };
  const local = env.kind === "local";
  const extras = extraSecrets(env);
  const accounts = accountRows(env);
  const claude = accounts.find((a) => a.part === "claude");
  const claudePick =
    claudeKey ||
    (claude &&
    claude.setKeys.includes("ANTHROPIC_API_KEY") &&
    !claude.setKeys.includes("CLAUDE_CODE_OAUTH_TOKEN")
      ? "ANTHROPIC_API_KEY"
      : "CLAUDE_CODE_OAUTH_TOKEN");
  const codexPick =
    codexKey ||
    (!env.codex_login && secretSet(env, "OPENAI_API_KEY") ? "api" : "chatgpt");
  const hooks = (
    <HooksBanner
      api={api}
      missing={env.hooks_missing}
      onFixed={() => {
        setLoads((n) => n + 1);
        onChanged();
      }}
    />
  );
  const notice = changed ? (
    <div className="notice" role="status">
      <span className="dot wait" />
      You changed {local ? "Your accounts" : env.name}.{" "}
      {env.used_by.length > 0
        ? matesText(env.used_by) + " get"
        : "Mates that use it get"}{" "}
      the change when their next conversation starts.
    </div>
  ) : null;
  const variables = (
    <>
      <div className="gtitle">
        {local ? "EXTRA SECRET VARIABLES" : "SECRET VARIABLES"}
        <span className="spacer" />
        <Button
          variant="quiet"
          className="xs"
          onClick={() =>
            setAsk({ title: "Add a secret variable", keys: [], label: "value" })
          }
        >
          + Add variable
        </Button>
      </div>
      {extras.length > 0 ? (
        <div className="group">
          {extras.map((s) => (
            <Opt key={s.name} label={s.name}>
              <span className="mono grow">{s.name}</span>
              <SecretButtons
                set={s.set}
                onSet={() =>
                  setAsk({
                    title: "Set " + s.name,
                    keys: [s.name],
                    label: "value",
                  })
                }
                onRemove={() => unset(s.name)}
                removeIcon
              />
            </Opt>
          ))}
        </div>
      ) : (
        <div className="group">
          <div className="opt">
            <span className="muted">No variables yet.</span>
          </div>
        </div>
      )}
    </>
  );
  const dialogs = (
    <>
      {ask ? (
        <SecretDialog
          api={api}
          env={env}
          ask={ask}
          onClose={() => setAsk(null)}
          onSaved={(out) => {
            setAsk(null);
            saved(out);
          }}
        />
      ) : null}
      {copying ? <CopyIdentity api={api} env={env} source={place.title} sourceKey={place.key} onClose={() => setCopying(false)} /> : null}
      {deleting ? (
        <DeleteDialog
          api={api}
          env={env}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false);
            onChanged();
            window.location.hash = "#/envs/" + encodeURIComponent(place.key);
          }}
        />
      ) : null}
    </>
  );
  const crumb = (
    <div className="crumb" aria-label="Breadcrumb">
      <span>{place.title}</span>
      <span>›</span>
      <b>{local ? "Your accounts" : env.name}</b>
    </div>
  );
  const backLink = back ? (
    <a className="ui icon-btn" href={"#/envs/" + encodeURIComponent(place.key)} aria-label="Back">
      ‹
    </a>
  ) : null;
  const head = local ? (
    <>
      {crumb}
      <div className="page-head">
        {backLink}
        <IdentityIcon env={env} />
        <h2>{"Your accounts on " + place.title}</h2>
        <span className="spacer" />
        <UsedBy env={env} />
      </div>
    </>
  ) : (
    <>
      {crumb}
      <div className="page-head">
        {backLink}
        <IdentityIcon env={env} />
        <h2>{env.name}</h2>
        <span className="pill blue">Separate identity</span>
        <span className="muted small">{"on " + place.where}</span>
        <span className="spacer" />
        <UsedBy env={env} />
        <MoreMenu onDelete={() => setDeleting(true)} onCopy={() => setCopying(true)} />
      </div>
    </>
  );
  if (local) {
    return (
      <div className="eedit">
        {head}
        <p className="dim lead">
          Mates with this environment act as you on {place.where}. They use the
          logins that are already here.
        </p>
        {hooks}
        {notice}
        <div className="gtitle">{"FOUND ON " + place.title.toUpperCase()}</div>
        <div className="group">
          {foundRows(env.local).map((r) => (
            <Opt key={r.label} label={r.label} title={r.label}>
              <span
                className={
                  r.label === "Git identity" || r.label === "SSH"
                    ? "dim"
                    : r.ok
                      ? "set-y"
                      : "set-n"
                }
              >
                {r.text}
              </span>
              {!r.ok && r.how ? <HowTo>{r.how}</HowTo> : null}
            </Opt>
          ))}
        </div>
        {variables}
        {note ? (
          <p className="error" role="alert">
            {note}
          </p>
        ) : null}
        <div className="eactions">
          <Button onClick={onNew}>Make a separate identity from this…</Button>
        </div>
        {dialogs}
      </div>
    );
  }
  return (
    <div className="eedit">
      {head}
      <p className="dim lead">
        Mates with this environment run on {place.where}, but not as you. They
        commit, push and call the harness with the accounts below.
      </p>
      {hooks}
      {notice}
      {env.parts.includes("git") ? (
        <GitIdentity
          key={
            env.name +
            "\n" +
            (env.git_name ?? "") +
            "\n" +
            (env.git_email ?? "")
          }
          api={api}
          env={env}
          onSaved={saved}
        />
      ) : null}
      {env.parts.includes("ssh") ? (
        <SSHKey api={api} env={env} onSaved={saved} />
      ) : null}
      {env.parts.includes("github") || accounts.length > 0 ? (
        <div className="gtitle">ACCOUNTS</div>
      ) : null}
      {env.parts.includes("github") ? (
        <>
          <div className="group">
            <Opt
              label="GitHub token"
              title="GitHub token"
              sub="For gh and HTTPS pushes"
            >
              <SecretButtons
                set={secretSet(env, "GH_TOKEN")}
                onSet={() =>
                  setAsk({
                    title: "Set GitHub token",
                    keys: ["GH_TOKEN"],
                    label: "token",
                  })
                }
                onRemove={() => unset("GH_TOKEN")}
              />
            </Opt>
          </div>
        </>
      ) : null}
      {accounts.length > 0 ? (
        <>
          <div className="group">
            {accounts.map((a) =>
              a.part === "claude" ? (
                <Opt
                  key={a.part}
                  label={a.title}
                  title={a.title}
                  sub={
                    <>
                      Setup token from{" "}
                      <span className="mono">claude setup-token</span>, or an
                      API key
                    </>
                  }
                >
                  <div
                    className="ui seg"
                    role="radiogroup"
                    aria-label="Claude login"
                  >
                    {[
                      { v: "CLAUDE_CODE_OAUTH_TOKEN", l: "Setup token" },
                      { v: "ANTHROPIC_API_KEY", l: "API key" },
                    ].map((o) => (
                      <button
                        key={o.v}
                        type="button"
                        role="radio"
                        aria-checked={claudePick === o.v}
                        className={claudePick === o.v ? "on" : undefined}
                        onClick={() => setClaudeKey(o.v)}
                      >
                        {o.l}
                      </button>
                    ))}
                  </div>
                  <SecretButtons
                    set={secretSet(env, claudePick)}
                    onSet={() =>
                      setAsk({
                        title:
                          claudePick === "ANTHROPIC_API_KEY"
                            ? "Set Claude API key"
                            : "Set Claude setup token",
                        keys: [claudePick],
                        label:
                          claudePick === "ANTHROPIC_API_KEY" ? "key" : "token",
                      })
                    }
                  />
                  {a.set ? null : (
                    <HowTo>
                      <span className="mono">{`crew env login ${env.name}`}</span>
                    </HowTo>
                  )}
                </Opt>
              ) : a.part === "codex" ? (
                <Opt
                  key={a.part}
                  label={a.title}
                  title={a.title}
                  sub={
                    codexPick === "chatgpt"
                      ? "ChatGPT login, kept in this environment"
                      : "OpenAI API key"
                  }
                >
                  <div
                    className="ui seg"
                    role="radiogroup"
                    aria-label="Codex login"
                  >
                    {[
                      { v: "chatgpt", l: "ChatGPT login" },
                      { v: "api", l: "API key" },
                    ].map((o) => (
                      <button
                        key={o.v}
                        type="button"
                        role="radio"
                        aria-checked={codexPick === o.v}
                        className={codexPick === o.v ? "on" : undefined}
                        onClick={() => setCodexKey(o.v)}
                      >
                        {o.l}
                      </button>
                    ))}
                  </div>
                  {codexPick === "chatgpt" ? (
                    <span className="secret">
                      {env.codex_login ? (
                        <span className="set-y">logged in</span>
                      ) : (
                        <>
                          <span className="set-n">not logged in</span>
                          <HowTo>
                            <span className="mono">{`crew env login ${env.name} --harness codex`}</span>
                          </HowTo>
                        </>
                      )}
                    </span>
                  ) : (
                    <SecretButtons
                      set={a.set}
                      onSet={() =>
                        setAsk({
                          title: "Set Codex API key",
                          keys: a.keys,
                          label: "key",
                        })
                      }
                      onRemove={() => a.setKeys.forEach(unset)}
                    />
                  )}
                </Opt>
              ) : (
                <Opt key={a.part} label={a.title} title={a.title} sub={a.sub}>
                  <SecretButtons
                    set={a.set}
                    onSet={() =>
                      setAsk({
                        title: "Set " + a.title + " API key",
                        keys:
                          a.part === "pi"
                            ? [
                                ...a.setKeys,
                                ...a.keys.filter((k) => !a.setKeys.includes(k)),
                              ]
                            : a.keys,
                        label: "key",
                      })
                    }
                    onRemove={() => a.setKeys.forEach(unset)}
                  />
                  {a.part === "pi" && env.pi_login ? (
                    <span className="secret">
                      <span className="set-y">logged in</span>
                    </span>
                  ) : a.part === "pi" && !a.set ? (
                    <span className="secret">
                      <span className="set-n">not logged in</span>
                    </span>
                  ) : null}
                  {a.set || (a.part === "pi" && env.pi_login) ? null : (
                    <HowTo>
                      {a.part === "pi" ? (
                        <>
                          <span className="mono">{`crew env login ${env.name} --harness omp`}</span>
                          {" or "}
                        </>
                      ) : null}
                      <span className="mono">{`crew env set ${env.name} ${a.keys[0] ?? ""}`}</span>
                    </HowTo>
                  )}
                </Opt>
              ),
            )}
          </div>
        </>
      ) : null}
      {variables}
      {note ? (
        <p className="error" role="alert">
          {note}
        </p>
      ) : null}
      <div className="muted small efoot">
        crew stores secrets on {place.where} and never shows them again.
      </div>
      {dialogs}
    </div>
  );
}

function NewDialog({
  api,
  onClose,
  onMade,
}: {
  api: Authed;
  onClose: () => void;
  onMade: (name: string) => void;
}) {
  const place = useContext(PlaceContext);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const made = await createEnv(api, { name: name.trim(), kind: "custom", parts: customParts });
      await envSSHKey(api, made.name, "make");
      onMade(made.name);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={"New separate identity on " + place.where} onClose={onClose} className="env-new">
      <label className="field">
        <span>Name</span>
        <input
          className="ui input"
          aria-label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="work-bot"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <div className="muted small">
        Its own git name, SSH key, GitHub token and harness accounts. crew makes
        the SSH key on {place.where}.
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="dialog-actions">
        <Button variant="quiet" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={busy || name.trim() === ""} onClick={() => void create()}>
          Create
        </Button>
      </div>
    </Dialog>
  );
}

function authedOf(link: MachineLink): Authed {
  return { fetch: link.fetch, token: link.token };
}

function useHub(api: Authed, desktop: DesktopBridge | undefined, tick: number) {
  const machines = useMemo(
    () => (desktop ? desktopMachines(desktop) : pairedMachines([{ key: "this", name: "", url: "", token: api.token, local: false }], api.fetch)),
    [desktop, api],
  );
  const [state, setState] = useState<{ links: MachineLink[]; hub: Hub } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let on = true;
    machines
      .links()
      .then(async (links) => {
        const hub = await loadHub(links);
        if (on) {
          setState({ links, hub });
          setError("");
        }
      })
      .catch((err) => on && setError(message(err)));
    return () => {
      on = false;
    };
  }, [machines, tick]);
  return { state, error };
}

export function Environments({ api, route, wide, desktop }: Props) {
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const { state, error } = useHub(api, desktop, tick);
  const [making, setMaking] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const servers = useMemo(() => (desktop ? new Servers(desktop) : undefined), [desktop]);
  const apis = useRef(new Map<string, Authed>());
  const remember = (link: MachineLink) => {
    const made = authedOf(link);
    apis.current.set(link.key, made);
    return made;
  };
  const slash = route.indexOf("/");
  const key = safe(slash < 0 ? route : route.slice(0, slash));
  const name = slash < 0 ? "" : safe(route.slice(slash + 1));
  const alert = error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;
  if (!state) {
    return wide ? <div className="envpane">{alert}</div> : <main className="screen mh-phone envs-phone">{alert}</main>;
  }
  const { hub, links } = state;
  const m = hub.machines.find((x) => x.key === key) ?? (wide && key === "" ? hub.machines[0] : undefined);
  const link = m ? links.find((l) => l.key === m.key) : undefined;
  const place: Place = m ? { title: machineTitle(m.local, m.name), where: machineWhere(m.local, m.name), key: m.key } : { title: "", where: "", key: "" };
  const linkApi = link ? (apis.current.get(link.key) ?? remember(link)) : api;
  const dialog =
    making && link ? (
      <NewDialog
        api={linkApi}
        onClose={() => setMaking(false)}
        onMade={(n) => {
          setMaking(false);
          reload();
          window.location.hash = identityHref(place.key, n);
        }}
      />
    ) : null;
  const machineAdd = servers ? () => setConnecting(true) : undefined;
  const connect =
    connecting && servers ? (
      <ConnectDialog
        servers={servers}
        onClose={() => setConnecting(false)}
        onDone={(id) => {
          setConnecting(false);
          reload();
          window.location.hash = machineHref(id);
        }}
      />
    ) : null;
  const right =
    m && name ? (
      <Editor key={m.key + "/" + name} api={linkApi} name={name} onChanged={reload} onNew={() => setMaking(true)} back={!wide} />
    ) : m ? (
      <MachineDetail
        key={m.key}
        m={m}
        link={link}
        hub={hub}
        wide={wide}
        onNew={() => setMaking(true)}
        servers={servers}
        onGone={() => {
          reload();
          window.location.hash = "#/envs";
        }}
      />
    ) : null;
  if (!wide) {
    return (
      <PlaceContext.Provider value={place}>
        <main className="screen mh-phone envs-phone">
          {alert}
          {right ?? <PhoneList hub={hub} onNew={machineAdd} />}
          {dialog}
          {connect}
        </main>
      </PlaceContext.Provider>
    );
  }
  return (
    <PlaceContext.Provider value={place}>
      <div className="envpane">
        <EnvList hub={hub} selected={{ key: m?.key ?? "", name }} onMachine={machineAdd} />
        {right ?? <div className="eedit">{alert}</div>}
        {dialog}
        {connect}
      </div>
    </PlaceContext.Provider>
  );
}
