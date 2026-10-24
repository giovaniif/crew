import { useState } from "react";
import { createEnv, envSSHKey, saveMate, type Authed } from "../api";
import type { KeyValue } from "../auth";
import { customParts, envParts } from "../envs";
import { useEnvs } from "./Environments";
import { useMachine } from "./Machine";
import { Button, RadioGroup, Select } from "../ui";
import { mateSlug, nameCheck } from "../matepage";
import { FaceButton } from "./Mates";

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

const roles: { label: string; prompt: string }[] = [
  { label: "Careful reviewer", prompt: "Review the pull requests of the team. Read each change with care and point out bugs, risks and missing tests." },
  { label: "Fast bug fixer", prompt: "Fix the bugs that the team gives you. Find the cause, make the smallest fix, add a test and open a pull request." },
  { label: "On-call triage", prompt: "Triage the alerts and the reports that come in. Find the likely cause, tell who owns it and suggest the next step." },
];

const fallbackPrompt = "Help the team with the tasks that it gives you.";

const handle = /^[a-z0-9][a-z0-9_-]{0,31}$/;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function FirstMate({ api, storage, wide }: { api: Authed; storage: KeyValue; wide: boolean }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [agent, setAgent] = useState<Harness>("claude");
  const [where, setWhere] = useState("local");
  const machine = useMachine();
  const { envs } = useEnvs(api);
  const custom = envs.filter((e) => e.kind === "custom");
  const places = [
    { value: "local", label: "Your accounts on " + machine, detail: "Uses the git, SSH, gh and Claude logins that are already on " + machine + ". Good for your own repos." },
    ...custom.map((e) => ({ value: "env:" + e.name, label: e.name, detail: envParts(e) })),
    { value: "new", label: "New environment…", detail: "A separate identity: its own git name, SSH key and tokens. Good for a bot or work account." },
  ];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [look, setLook] = useState<{ avatar?: string; color?: string }>({});
  const mate = mateSlug(name);
  const valid = handle.test(mate);

  async function create() {
    setBusy(true);
    setError("");
    try {
      if (where.startsWith("env:")) {
        await saveMate(api, { name: mate, prompt: prompt.trim() || fallbackPrompt, agent, env: where.slice(4), ...look, enabled: true });
        window.location.hash = "#/mates/" + encodeURIComponent(mate);
        return;
      }
      if (where === "new") {
        const env = await createEnv(api, { name: mate, kind: "custom", parts: customParts });
        await envSSHKey(api, env.name, "make");
        await saveMate(api, { name: mate, prompt: prompt.trim() || fallbackPrompt, agent, env: env.name, ...look, enabled: true });
        window.location.hash = "#/envs/" + encodeURIComponent(env.name);
        return;
      }
      await saveMate(api, { name: mate, prompt: prompt.trim() || fallbackPrompt, agent, ...look, enabled: true });
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

  if (!wide) {
    return (
      <main className="fm fm-phone">
        <h1>Make your first mate</h1>
        <p className="lead">A mate is an agent that stays: a name, a role, its own threads.</p>
        <input className="ui input" aria-label="Name" placeholder="Name" autoCapitalize="off" spellCheck={false} value={name} onChange={(e) => setName(e.target.value)} />
        <Select label="Harness" value={agent} options={harnesses} onChange={setAgent} className="fm-select" />
        <Select
          label="Environment"
          value={where}
          options={places.map((o) => ({ value: o.value, label: "Environment: " + o.label }))}
          onChange={setWhere}
          className="fm-select"
        />
        <Button variant="primary" disabled={!valid || busy} onClick={() => void create()}>
          Next
        </Button>
        {alert}
        {instead}
      </main>
    );
  }

  return (
    <main className="fm">
      <ol className="fm-steps" aria-label="Progress">
        <li data-state="on" />
        <li data-state={step === 2 ? "on" : "off"} />
      </ol>
      {step === 1 ? (
        <>
          <h1>Make your first mate</h1>
          <p className="lead">A mate is an agent that stays: it has a name, a role, its own threads, and it can answer in Slack.</p>
          <form
            className="fm-composer"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) {
                setStep(2);
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
              <span className="spacer" />
              <Button variant="primary" type="submit" className="fm-next" disabled={!valid}>
                Next
              </Button>
            </div>
          </form>
          <div className="fm-suggest">
            {roles.map((r) => (
              <button key={r.label} type="button" className="ui chip" onClick={() => setPrompt(r.prompt)}>
                {r.label}
              </button>
            ))}
          </div>
          {instead}
        </>
      ) : (
        <>
          <h1>{"Whose accounts does " + mate + " use?"}</h1>
          <p className="lead">{mate + " runs on " + machine + ". Pick the git identity, SSH key and logins it uses there. You can change it later."}</p>
          <RadioGroup
            label="Environment"
            className="fm-pick"
            itemClassName="preset"
            value={where}
            onChange={setWhere}
            options={places.map((o) => ({
              value: o.value,
              label: <span className="t">{o.label}</span>,
              detail: <span className="s">{o.detail}</span>,
            }))}
          />
          <div className="fm-buttons">
            <Button variant="quiet" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void create()}>
              {"Create " + mate}
            </Button>
          </div>
          {alert}
        </>
      )}
    </main>
  );
}
