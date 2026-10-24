import { useState } from "react";
import { identityCopyBegin, identityExport, identityImport, type Authed, type EnvInfo } from "../api";
import { envGroups } from "../envmenu";
import { authedOf, useHub } from "../hub";
import { Button, Dialog, Select } from "../ui";

function copyText(text: string) {
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

function Copied({ env, target, source, onDone }: { env: EnvInfo; target: { key: string; label: string }; source: string; onDone: () => void }) {
  const key = env.public_key ?? env.new_public_key ?? "";
  const git = [env.git_name, env.git_email].filter(Boolean).join(" · ");
  return (
    <Dialog title={env.name} onClose={onDone} className="copy-identity">
      <p className="muted small">{"on " + target.label + " · copied from " + source}</p>
      <div className="gtitle">SSH KEY</div>
      <div className="group">
        <div className="opt keyopt stretch">
          <div className="keyhead">
            <span className="t">{"New ed25519 key on " + target.label}</span>
            <span className="pill warn">add to GitHub</span>
            <span className="spacer" />
            <Button className="sm" onClick={() => copyText(key)}>
              Copy public key
            </Button>
          </div>
          <div className="keybox">{key}</div>
          <div className="keywarn">
            <span className="dot wait" />
            <div className="kw-body">
              <div className="dim">{"Add this key to the GitHub account of " + env.name + ". Until then, mates on " + target.label + " with " + env.name + " cannot push over SSH."}</div>
            </div>
          </div>
        </div>
      </div>
      <div className="gtitle">{"COPIED FROM " + source.toUpperCase()}</div>
      <div className="group">
        {git ? (
          <div className="opt">
            <span>Git name</span>
            <span className="spacer" />
            <span className="dim">{git}</span>
          </div>
        ) : null}
        {env.secrets.map((s) => (
          <div key={s.name} className="opt">
            <span>{s.name === "GH_TOKEN" ? "GitHub token" : s.name}</span>
            <span className="spacer" />
            <span className="dim">{s.set ? "set" : "not set"}</span>
          </div>
        ))}
      </div>
      <div className="dialog-actions">
        <Button variant="primary" onClick={onDone}>
          I added it
        </Button>
      </div>
    </Dialog>
  );
}

export function CopyIdentity({ api, env, source, sourceKey, onClose }: { api: Authed; env: EnvInfo; source: string; sourceKey: string; onClose: () => void }) {
  const state = useHub(api);
  const targets = state.hub ? envGroups(state.hub).filter((g) => g.up && g.key !== sourceKey) : [];
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [made, setMade] = useState<EnvInfo | null>(null);
  const target = targets.find((g) => g.key === key) ?? targets[0];

  async function run() {
    const link = state.links.find((l) => l.key === target?.key);
    if (!link) {
      return;
    }
    setBusy(true);
    setNote("");
    try {
      const to = authedOf(link);
      const begin = await identityCopyBegin(to);
      const sealed = await identityExport(api, env.name, begin.public_key);
      setMade(await identityImport(to, begin.copy_id, sealed.bundle));
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (made && target) {
    return (
      <Copied
        env={made}
        target={target}
        source={source}
        onDone={() => {
          onClose();
          window.location.hash = "#/envs/" + encodeURIComponent(target.key) + "/" + encodeURIComponent(made.name);
        }}
      />
    );
  }
  const where = target?.label ?? "The target machine";
  return (
    <Dialog title={"Copy " + env.name + " to another machine"} onClose={onClose} className="copy-mate">
      <p>{"crew makes a new identity on the target machine. The original on " + source + " does not change."}</p>
      {targets.length === 0 ? (
        <p className="muted">{state.hub ? "No other machine is connected. Use + Machine to connect a server." : "Loading…"}</p>
      ) : (
        <div className="fld">
          <label>Target machine</label>
          <Select label="Target machine" value={target!.key} options={targets.map((g) => ({ value: g.key, label: g.label }))} onChange={setKey} />
        </div>
      )}
      <div className="steplist">
        <div>Git name and email: copied</div>
        <div>GitHub token, Claude key, secret variables: copied</div>
        <div>{"SSH key: " + where + " makes a new key. Add it to GitHub after the copy."}</div>
      </div>
      {note && (
        <p className="error" role="alert">
          {note}
        </p>
      )}
      <div className="dialog-actions">
        <Button variant="quiet" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={busy || !target} onClick={() => void run()}>
          Copy
        </Button>
      </div>
    </Dialog>
  );
}
