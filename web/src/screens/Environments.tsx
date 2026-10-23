import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  type Authed,
  createEnv,
  deleteEnv,
  type EnvInfo,
  envSSHKey,
  getEnv,
  listEnvs,
  setEnv,
  unsetEnvSecret,
} from "../api";
import {
  accountRows,
  customParts,
  envLetter,
  envSub,
  envTitle,
  extraSecrets,
  isLocal,
  matesText,
  secretSet,
  usedLabel,
} from "../envs";
import { Button, Dialog, Menu, Select } from "../ui";
import { MateFace } from "./Mates";

type Props = { api: Authed; name: string; wide: boolean };

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function useEnvs(api: Authed): {
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
          setEnvs(out.envs);
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

function EIcon({ env }: { env: EnvInfo }) {
  return (
    <span
      className={"eicon" + (env.kind === "custom" ? " c" : "")}
      aria-hidden="true"
    >
      {envLetter(env)}
    </span>
  );
}

function EnvList({
  envs,
  selected,
  onNew,
}: {
  envs: EnvInfo[];
  selected: string;
  onNew: () => void;
}) {
  return (
    <div className="elist">
      <div className="elist-head">
        <span className="elist-title">Environments</span>
        <span className="spacer" />
        <Button variant="primary" className="sm" onClick={onNew}>
          New
        </Button>
      </div>
      <ul className="side-scroll elist-rows" aria-label="Environments">
        {envs.map((e) => (
          <li key={e.name}>
            <a
              className={"row" + (e.name === selected ? " on" : "")}
              href={"#/envs/" + encodeURIComponent(e.name)}
              aria-current={e.name === selected ? "page" : undefined}
            >
              <EIcon env={e} />
              <div className="nm">
                <div>{envTitle(e)}</div>
                <div className="s">{envSub(e)}</div>
              </div>
            </a>
          </li>
        ))}
      </ul>
      <div className="elist-foot muted">
        A mate runs with the git identity, keys and accounts of its environment.
      </div>
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
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const saved = useRef("");
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
      <div className="gtitle">GIT IDENTITY</div>
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
  const [next, setNext] = useState("");
  const [error, setError] = useState("");
  const run = (action: "make" | "rotate" | "confirm") => {
    setError("");
    envSSHKey(api, env.name, action)
      .then((out) => {
        if (action === "rotate" && out.new_public_key) {
          setNext(out.new_public_key);
          onSaved(out, false);
          return;
        }
        setNext("");
        onSaved(out, true);
      })
      .catch((err) => setError(message(err)));
  };
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
                    onClick={() => setNext("")}
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
              {env.public_key ? "ed25519 key made by crew" : "No SSH key yet"}
            </span>
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
            Add this key to GitHub: Settings › SSH and GPG keys › New SSH key.
            The private key never leaves this machine.
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
        <span className="small used-names">
          {env.used_by.length > 0 ? env.used_by.join(", ") : "no mate"}
        </span>
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

function MoreMenu({ onDelete }: { onDelete: () => void }) {
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
          items={[{ value: "delete", label: "Delete…" }]}
          onPick={() => {
            setOpen(false);
            onDelete();
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
  onNew: (kind: "custom") => void;
  back: boolean;
}) {
  const [env, setEnvInfo] = useState<EnvInfo | null>(null);
  const [error, setError] = useState("");
  const [changed, setChanged] = useState(false);
  const [ask, setAsk] = useState<SecretAsk | null>(null);
  const [claudeKey, setClaudeKey] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => {
    let on = true;
    setEnvInfo(null);
    setChanged(false);
    setClaudeKey("");
    getEnv(api, name)
      .then((out) => on && (setEnvInfo(out), setError("")))
      .catch((err) => on && setError(message(err)));
    return () => {
      on = false;
    };
  }, [api, name]);
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
  const notice = changed ? (
    <div className="notice" role="status">
      <span className="dot wait" />
      You changed this environment.{" "}
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
      {deleting ? (
        <DeleteDialog
          api={api}
          env={env}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false);
            onChanged();
            window.location.hash = "#/envs";
          }}
        />
      ) : null}
    </>
  );
  const head = (
    <div className="page-head">
      {back ? (
        <a className="ui icon-btn" href="#/envs" aria-label="Back">
          ‹
        </a>
      ) : null}
      <EIcon env={env} />
      <h2>{envTitle(env)}</h2>
      {local ? (
        <span className="pill">Local</span>
      ) : (
        <span className="pill blue">Custom</span>
      )}
      {local ? null : (
        <span className="muted small">isolated · kind is set at creation</span>
      )}
      <span className="spacer" />
      <UsedBy env={env} />
      {isLocal(env) ? null : <MoreMenu onDelete={() => setDeleting(true)} />}
    </div>
  );
  if (local) {
    return (
      <div className="eedit">
        {head}
        <p className="dim lead">
          Mates in this environment act as you. They use what is already set up
          on this machine. crew reads these values and does not change them.
        </p>
        {notice}
        <div className="gtitle">FOUND ON THIS MAC</div>
        <div className="group">
          {["Git identity", "SSH", "GitHub CLI", "Claude", "Codex", "Pi"].map(
            (t) => (
              <div className="opt" key={t}>
                <div className="l t">{t}</div>
                <span className="dim">your login on this machine</span>
              </div>
            ),
          )}
        </div>
        {variables}
        {note ? (
          <p className="error" role="alert">
            {note}
          </p>
        ) : null}
        <div className="eactions">
          <Button onClick={() => onNew("custom")}>Duplicate as Custom…</Button>
        </div>
        {dialogs}
      </div>
    );
  }
  return (
    <div className="eedit">
      {head}
      {notice}
      {env.parts.includes("git") ? (
        <GitIdentity api={api} env={env} onSaved={saved} />
      ) : null}
      {env.parts.includes("ssh") ? (
        <SSHKey api={api} env={env} onSaved={saved} />
      ) : null}
      {env.parts.includes("github") ? (
        <>
          <div className="gtitle">GITHUB</div>
          <div className="group">
            <Opt
              label="GitHub token"
              title="Token"
              sub="Used by gh and for HTTPS pushes. Needs repo scope."
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
          <div className="gtitle">HARNESS ACCOUNTS</div>
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
                    onRemove={() => unset(claudePick)}
                  />
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
        crew stores secrets on this machine and never shows them again. You can
        replace or remove a secret, but not read it.
      </div>
      {dialogs}
    </div>
  );
}

function NewDialog({
  api,
  kind: start,
  onClose,
  onMade,
}: {
  api: Authed;
  kind: "custom" | "local";
  onClose: () => void;
  onMade: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"custom" | "local">(start);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const made = await createEnv(
        api,
        kind === "custom"
          ? { name: name.trim(), kind, parts: customParts }
          : { name: name.trim(), kind },
      );
      if (kind === "custom") {
        await envSSHKey(api, made.name, "make");
      }
      onMade(made.name);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };
  const kinds: { v: "custom" | "local"; t: string; s: string }[] = [
    {
      v: "custom",
      t: "Custom",
      s: "Isolated. Its own git identity, SSH key, GitHub token and accounts.",
    },
    {
      v: "local",
      t: "Local (this Mac)",
      s: "Acts as you, with the logins of this machine.",
    },
  ];
  return (
    <Dialog title="New environment" onClose={onClose} className="env-new">
      <label className="field">
        <span>Name</span>
        <input
          className="ui input"
          aria-label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="work"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <div className="kind" role="radiogroup" aria-label="Kind">
        {kinds.map((k) => (
          <button
            key={k.v}
            type="button"
            role="radio"
            aria-checked={kind === k.v}
            className={"preset" + (kind === k.v ? " on" : "")}
            onClick={() => setKind(k.v)}
          >
            <div>
              <div className="t">{k.t}</div>
              <div className="s">{k.s}</div>
            </div>
          </button>
        ))}
      </div>
      <div className="muted small">
        You select the kind only now. You cannot change it later.
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
          disabled={busy || name.trim() === ""}
          onClick={() => void create()}
        >
          Create
        </Button>
      </div>
    </Dialog>
  );
}

export function Environments({ api, name, wide }: Props) {
  const { envs, error, reload } = useEnvs(api);
  const [making, setMaking] = useState<"custom" | "local" | null>(null);
  const selected = name || (wide ? (envs[0]?.name ?? "") : "");
  const dialog = making ? (
    <NewDialog
      api={api}
      kind={making}
      onClose={() => setMaking(null)}
      onMade={(n) => {
        setMaking(null);
        reload();
        window.location.hash = "#/envs/" + encodeURIComponent(n);
      }}
    />
  ) : null;
  const alert = error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;
  if (!wide) {
    if (name) {
      return (
        <main className="screen mh-phone envs-phone">
          <Editor
            key={name}
            api={api}
            name={name}
            onChanged={reload}
            onNew={setMaking}
            back
          />
          {dialog}
        </main>
      );
    }
    return (
      <main className="screen mh-phone envs-phone">
        {alert}
        <EnvList envs={envs} selected="" onNew={() => setMaking("custom")} />
        {dialog}
      </main>
    );
  }
  return (
    <div className="envpane">
      <EnvList
        envs={envs}
        selected={selected}
        onNew={() => setMaking("custom")}
      />
      {selected ? (
        <Editor
          key={selected}
          api={api}
          name={selected}
          onChanged={reload}
          onNew={setMaking}
          back={false}
        />
      ) : (
        <div className="eedit">{alert}</div>
      )}
      {dialog}
    </div>
  );
}
