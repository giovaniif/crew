import { useEffect, useMemo, useState } from "react";
import { saveMate, type Authed, type EnvInfo, type EnvLocal } from "../api";
import type { KeyValue } from "../auth";
import type { DesktopBridge } from "../desktopBridge";
import { envOrder, machineTitle } from "../envs";
import { desktopMachines, loadHub, pairedMachines, type MachineLink, type MachineState } from "../machines";
import { Servers, sshTarget } from "../servers";
import { Button, RadioGroup, Select } from "../ui";
import { mateSlug, nameCheck } from "../matepage";
import { FaceButton } from "./Mates";
import { LocalHooksBanner } from "./HooksBanner";

const skipKey = "crew.firstmate";

export function firstMateSkipped(storage: KeyValue): boolean {
  try {
    return storage.getItem(skipKey) === "skip";
  } catch {
    return false;
  }
}

function skip(storage: KeyValue) {
  try {
    storage.setItem(skipKey, "skip");
  } catch {
    return;
  }
}

type Harness = "claude" | "codex" | "omp";

const harnesses: { value: Harness; label: string }[] = [
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
  { value: "omp", label: "Pi" },
];

const fallbackPrompt = "Help the team with the tasks that it gives you.";

const handle = /^[a-z0-9][a-z0-9_-]{0,31}$/;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type Place = { link: MachineLink; machine: MachineState; identities: EnvInfo[] };

function chips(f: EnvLocal | null | undefined): { text: string; ok: boolean }[] {
  if (!f) {
    return [];
  }
  return [
    { text: f.git_name ? "git: " + f.git_name : "git", ok: f.git_name !== "" },
    { text: "SSH", ok: f.ssh_agent || f.ssh_keys > 0 },
    { text: f.github ? (f.github_user ? "gh @" + f.github_user : "gh") : "gh", ok: f.github },
    { text: "Claude", ok: f.claude },
    { text: "Codex", ok: f.codex },
    { text: "Pi", ok: f.pi },
  ];
}

async function placeOf(link: MachineLink): Promise<Place> {
  const hub = await loadHub([link]);
  const machine = hub.machines[0];
  if (!machine || machine.state !== "up") {
    throw new Error("machine not reachable");
  }
  return { link, machine, identities: envOrder(hub.environments.map((e) => e.item)) };
}

function envLabel(place: Place, e: EnvInfo): string {
  return machineTitle(place.machine.local, place.machine.name) + " · " + (e.kind === "local" ? "your accounts" : e.name);
}

function Progress({ at }: { at: number }) {
  return (
    <ol className="fm-steps" aria-label="Progress">
      {[1, 2, 3].map((n) => (
        <li key={n} data-state={n <= at ? "on" : "off"} />
      ))}
    </ol>
  );
}

export function FirstMate({ api, storage, wide, desktop }: { api: Authed; storage: KeyValue; wide: boolean; desktop?: DesktopBridge }) {
  const servers = useMemo(() => (desktop ? new Servers(desktop) : undefined), [desktop]);
  const [step, setStep] = useState<"where" | "ready" | "mate">(desktop && wide ? "where" : "ready");
  const [place, setPlace] = useState<Place | null>(null);
  const [pick, setPick] = useState<"this" | "ssh">("ssh");
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [agent, setAgent] = useState<Harness>("claude");
  const [identity, setIdentity] = useState("yours");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [look, setLook] = useState<{ avatar?: string; color?: string }>({});
  const placeApi = useMemo(() => (place ? { fetch: place.link.fetch, token: place.link.token } : null), [place]);
  const mate = mateSlug(name);
  const valid = handle.test(mate);

  useEffect(() => {
    if (desktop && wide) {
      return;
    }
    let on = true;
    const links = desktop ? desktopMachines(desktop).links() : pairedMachines([{ key: "this", name: "", url: "", token: api.token, local: false }], api.fetch).links();
    links
      .then((all) => placeOf(all[0]))
      .then((p) => on && setPlace(p))
      .catch((err) => on && setError(message(err)));
    return () => {
      on = false;
    };
  }, [api, desktop, wide]);

  async function connect() {
    if (!desktop || !servers) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      let id = "local";
      if (pick === "ssh") {
        const target = sshTarget(address);
        if (!target) {
          throw new Error("Type a host name, not ssh options.");
        }
        const remote = await servers.crew(target);
        if (remote.action !== "current") {
          await servers.install(target);
        }
        id = await servers.add("ssh", target);
      }
      const links = await desktopMachines(desktop).links();
      const link = links.find((l) => l.key === id);
      if (!link) {
        throw new Error("machine not reachable");
      }
      setPlace(await placeOf(link));
      setIdentity("yours");
      setStep("ready");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!place?.machine.machine) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await saveMate(
        { fetch: place.link.fetch, token: place.link.token },
        { name: mate, prompt: prompt.trim() || fallbackPrompt, agent, ...look, enabled: true },
        { machine_id: place.machine.machine.id, identity_id: identity },
      );
      window.location.hash = "#/mates/" + encodeURIComponent(mate);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const alert = error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;

  const instead = (
    <p className="fm-instead muted">
      Only want to run a local agent?{" "}
      <a
        href="#/new"
        onClick={(e) => {
          e.preventDefault();
          skip(storage);
          window.location.hash = "#/new";
        }}
      >
        Start a session
      </a>{" "}
      instead.
    </p>
  );

  const envOptions = place
    ? place.identities.map((e) => ({ value: e.kind === "local" ? "yours" : e.name, label: envLabel(place, e) }))
    : [];
  const chosen = place?.identities.find((e) => (e.kind === "local" ? "yours" : e.name) === identity);
  const where = place ? machineTitle(place.machine.local, place.machine.name) : "";
  const gitName = chosen?.kind === "local" ? place?.machine.found?.git_name : chosen?.git_name;

  if (!wide) {
    return (
      <main className="fm fm-phone">
        <h1>Make your first mate</h1>
        <p className="lead">A mate is an agent that stays: a name, a role and its own threads.</p>
        <input className="ui input" aria-label="Name" placeholder="Name" autoCapitalize="off" spellCheck={false} value={name} onChange={(e) => setName(e.target.value)} />
        <Select label="Harness" value={agent} options={harnesses} onChange={setAgent} className="fm-select" />
        {place ? <Select label="Environment" value={identity} options={envOptions} onChange={setIdentity} className="fm-select" /> : null}
        <Button variant="primary" disabled={!valid || busy || !place} onClick={() => void create()}>
          Next
        </Button>
        {alert}
        {instead}
      </main>
    );
  }

  if (step === "where") {
    return (
      <main className="fm">
        <Progress at={1} />
        <h1>Where does crew run your mates?</h1>
        <p className="lead">Pick the machine. Mates on a server keep working when this Mac sleeps.</p>
        <RadioGroup
          label="Machine"
          className="fm-pick fm-where"
          itemClassName="preset"
          value={pick}
          onChange={(v) => setPick(v as "this" | "ssh")}
          options={[
            { value: "this", label: <span className="t">This Mac</span>, detail: <span className="s">Mates stop when the Mac sleeps.</span> },
            { value: "ssh", label: <span className="t">A server over SSH</span>, detail: <span className="s">A Linux box or VM that you can SSH to.</span> },
          ]}
        />
        {pick === "ssh" ? (
          <>
            <input
              className="ui input mono fm-address"
              aria-label="SSH host"
              placeholder="user@host or server"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
            <p className="fm-hint muted">Type the host as for ssh: user@host or a Host alias of ~/.ssh/config. Do not type the ssh command.</p>
          </>
        ) : null}
        <div className="fm-buttons">
          <Button variant="primary" disabled={busy || (pick === "ssh" && address.trim() === "")} onClick={() => void connect()}>
            Connect
          </Button>
        </div>
        {alert}
        {instead}
      </main>
    );
  }

  if (step === "ready" || !place) {
    return (
      <main className="fm">
        <Progress at={2} />
        {place ? (
          <>
            <h1>{where + " is ready"}</h1>
            <p className="lead">{"crew runs on " + (place.machine.local ? "this Mac" : where) + " now. It found your logins there, so this environment is ready to use."}</p>
            <div className="envcard" role="group" aria-label={where + " · your accounts"}>
              <div className="ech">
                <span className="eicon m" aria-hidden="true">
                  {place.machine.local ? "⌘" : "▣"}
                </span>
                <div className="ech-t">
                  <div className="t">{where + " · your accounts"}</div>
                  <div className="s">New environment</div>
                </div>
                <span className="pill ok">connected</span>
              </div>
              <div className="echips">
                {chips(place.machine.found).map((c) => (
                  <span key={c.text} className={c.ok ? "set-y" : "set-n"}>
                    {c.text}
                  </span>
                ))}
              </div>
              <div className="muted small">
                {"Mates in this environment act as you on " + (place.machine.local ? "this Mac" : where) + ". To use a bot account, add a separate identity later in Environments."}
              </div>
            </div>
            {placeApi && step === "ready" ? <LocalHooksBanner api={placeApi} /> : null}
            <div className="fm-buttons">
              {desktop ? (
                <Button variant="quiet" onClick={() => setStep("where")}>
                  Back
                </Button>
              ) : null}
              <Button variant="primary" onClick={() => setStep("mate")}>
                Next: make a mate
              </Button>
            </div>
          </>
        ) : (
          <div aria-busy="true" />
        )}
        {alert}
        {instead}
      </main>
    );
  }

  return (
    <main className="fm">
      <Progress at={3} />
      <h1>Make your first mate</h1>
      <p className="lead">A mate is an agent that stays: a name, a role and its own threads.</p>
      <form
        className="fm-composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) {
            void create();
          }
        }}
      >
        <div className="fm-name">
          {valid ? (
            <FaceButton name={mate} avatar={look.avatar} color={look.color} onPick={(patch) => setLook({ ...look, ...patch })} />
          ) : (
            <span className="fm-q" aria-hidden="true">?</span>
          )}
          <input aria-label="Name" placeholder="Name, for example ada" autoCapitalize="off" spellCheck={false} value={name} onChange={(e) => setName(e.target.value)} />
          {valid && mate !== name && <span className="fm-slug muted">{"Saved as " + mate}</span>}
          {!valid && name.trim() !== "" && <span className="fm-slug bad">{nameCheck(mate || name.trim(), []).text}</span>}
        </div>
        <textarea aria-label="Role" rows={2} placeholder="What should it do? For example: review PRs in api and web." value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <div className="fm-foot">
          <Select label="Harness" value={agent} options={harnesses} onChange={setAgent} className="fm-chip" />
          <Select label="Environment" value={identity} options={envOptions} onChange={setIdentity} className="fm-chip fm-env" />
          <span className="spacer" />
          <Button variant="primary" type="submit" className="fm-next" disabled={!valid || busy}>
            {"Create " + (mate || "mate")}
          </Button>
        </div>
      </form>
      {valid ? <div className="muted small fm-note">{mate + " runs on " + where + (gitName ? " and commits as " + gitName : "") + "."}</div> : null}
      <div className="fm-buttons">
        <Button variant="quiet" onClick={() => setStep("ready")}>
          Back
        </Button>
      </div>
      {alert}
    </main>
  );
}
