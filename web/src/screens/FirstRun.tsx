import { useEffect, useState, type FormEvent } from "react";
import { backStep, flowSteps, nextStep, primaryTitle, sshTarget, stepTitle, type Servers, type Step, type Where } from "../servers";
import { RadioGroup, Suggest } from "../ui";

type SetupState = { state: "idle" } | { state: "busy" } | { state: "done"; id: string } | { state: "failed"; message: string };

export type FirstRunProps = { servers: Servers; welcome: boolean; onClose: () => void };

const choices: { where: Where; title: string; detail: string }[] = [
  { where: "local", title: "This computer", detail: "Agents run here. The app starts crew for you." },
  { where: "url", title: "A server with crew serve", detail: "Type its address and a code from crew remote pair." },
  { where: "ssh", title: "A server over SSH", detail: "The app runs crew setup daemon on it, then pairs through an SSH tunnel." },
];

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function FirstRun({ servers, welcome, onClose }: FirstRunProps) {
  const [step, setStep] = useState<Step>(welcome ? "welcome" : "location");
  const [where, setWhere] = useState<Where>("local");
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [host, setHost] = useState("");
  const [hosts, setHosts] = useState<string[]>([]);
  const [setup, setSetup] = useState<SetupState>({ state: "idle" });
  const [path, setPath] = useState("");
  const [workspace, setWorkspace] = useState<{ state: "idle" | "busy" | "added" } | { state: "failed"; message: string }>({ state: "idle" });
  const [openError, setOpenError] = useState("");

  useEffect(() => {
    if (where !== "ssh") {
      return;
    }
    let live = true;
    servers.hosts().then(
      (h) => live && setHosts(h),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [servers, where]);

  const steps = flowSteps(where);
  const at = steps.indexOf(step);
  const target = where === "ssh" ? host.trim() : where === "url" ? address.trim() : "This computer";
  const hostBad = where === "ssh" && host.trim() !== "" && sshTarget(host) === null;
  const id = setup.state === "done" ? setup.id : "";

  const ready = (() => {
    switch (step) {
      case "host":
        return where === "ssh" ? sshTarget(host) !== null : address.trim() !== "" && code.trim() !== "";
      case "setup":
        return setup.state === "done";
      default:
        return true;
    }
  })();

  function choose(next: Where) {
    setWhere(next);
    setSetup({ state: "idle" });
  }

  async function runSetup() {
    setSetup({ state: "busy" });
    try {
      if (where === "local") {
        await servers.fix("local");
        setSetup({ state: "done", id: "local" });
      } else {
        const added = await servers.add(where, where === "ssh" ? host.trim() : address.trim(), where === "url" ? code.trim() : "");
        setSetup({ state: "done", id: added });
      }
    } catch (err) {
      setSetup({ state: "failed", message: errorText(err) });
    }
  }

  async function addWorkspace(event: FormEvent) {
    event.preventDefault();
    setWorkspace({ state: "busy" });
    try {
      await servers.workspace(id, path.trim());
      setWorkspace({ state: "added" });
    } catch (err) {
      setWorkspace({ state: "failed", message: errorText(err) });
    }
  }

  async function primary() {
    if (step !== "done") {
      setStep(nextStep(step, where));
      return;
    }
    setOpenError("");
    try {
      await servers.open(id);
      onClose();
    } catch (err) {
      setOpenError(errorText(err));
    }
  }

  return (
    <div className="first-run">
      <ol className="first-run-steps" aria-label="Steps">
        {steps.map((s, i) => (
          <li key={s} aria-current={s === step ? "step" : undefined} className={i < at ? "complete" : undefined}>
            {stepTitle(s)}
          </li>
        ))}
      </ol>
      <div className="first-run-body">
        <h2>{stepTitle(step)}</h2>
        {step === "welcome" ? (
          <p className="lead">The next steps pick where agents run, set that computer up and add a workspace. Nothing needs sudo.</p>
        ) : null}
        {step === "location" ? (
          <fieldset className="choices">
            <legend>Where do agents run?</legend>
            <RadioGroup
              label="Where do agents run?"
              className="where-choices"
              itemClassName="where-choice"
              value={where}
              onChange={choose}
              options={choices.map((c) => ({ value: c.where, label: <span className="where-title">{c.title}</span>, detail: <span className="muted">{c.detail}</span> }))}
            />
          </fieldset>
        ) : null}
        {step === "host" && where === "url" ? (
          <div className="fields">
            <label>
              Address
              <input type="text" inputMode="url" autoCapitalize="off" spellCheck={false} placeholder="crew.example.ts.net" value={address} onChange={(e) => setAddress(e.target.value)} />
            </label>
            <label>
              Pairing code
              <input type="text" autoCapitalize="characters" spellCheck={false} placeholder="ABCD2345" value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            <p className="muted">
              Run <code>crew remote pair</code> on the server to get a code.
            </p>
          </div>
        ) : null}
        {step === "host" && where === "ssh" ? (
          <div className="fields">
            <label>
              SSH host
              <Suggest label="SSH host" suggestions={hosts} autoCapitalize="off" spellCheck={false} placeholder="user@host" value={host} onChange={setHost} />
            </label>
            {hostBad ? (
              <p className="error" role="alert">
                Type a host name or user@host. Options and spaces are not allowed.
              </p>
            ) : (
              <p className="muted">The hosts come from ~/.ssh/config. The app uses key login only.</p>
            )}
          </div>
        ) : null}
        {step === "setup" ? (
          <div className="fields">
            <p className="muted">
              {where === "local"
                ? "The app runs crew setup daemon on this computer."
                : where === "ssh"
                  ? "The app runs crew setup daemon on " + target + ", starts crew serve through an SSH tunnel and pairs with it."
                  : "The app pairs with " + target + " and keeps the login in its data folder."}
            </p>
            {setup.state === "done" ? (
              <p role="status">{target + " is set up."}</p>
            ) : (
              <button type="button" className="flow-button" disabled={setup.state === "busy"} onClick={runSetup}>
                {setup.state === "busy" ? "Setting up…" : setup.state === "failed" ? "Try again" : "Set up"}
              </button>
            )}
            {setup.state === "failed" ? (
              <p className="error" role="alert">
                {setup.message}
              </p>
            ) : null}
          </div>
        ) : null}
        {step === "workspace" ? (
          <form className="fields" onSubmit={addWorkspace}>
            <label>
              Workspace folder
              <input type="text" autoCapitalize="off" spellCheck={false} placeholder="~/code/api" value={path} onChange={(e) => setPath(e.target.value)} />
            </label>
            <button type="submit" className="flow-button" disabled={path.trim() === "" || workspace.state === "busy"}>
              Add workspace
            </button>
            {workspace.state === "added" ? <p role="status">Added {path.trim()}.</p> : null}
            {workspace.state === "failed" ? (
              <p className="error" role="alert">
                {workspace.message}
              </p>
            ) : null}
            <p className="muted">A workspace is a git repository or a folder of them. You can skip this step.</p>
          </form>
        ) : null}
        {step === "done" ? <p className="lead">{target} is ready. Open crew to start a session.</p> : null}
        {openError ? (
          <p className="error" role="alert">
            {openError}
          </p>
        ) : null}
        <div className="first-run-buttons">
          {step !== "welcome" && !(step === "location" && !welcome) ? (
            <button type="button" className="flow-button" onClick={() => setStep(backStep(step, where))}>
              Back
            </button>
          ) : (
            <button type="button" className="flow-button" onClick={onClose}>
              Cancel
            </button>
          )}
          <button type="button" className="flow-button flow-primary" disabled={!ready} onClick={primary}>
            {primaryTitle(step)}
          </button>
        </div>
      </div>
    </div>
  );
}
