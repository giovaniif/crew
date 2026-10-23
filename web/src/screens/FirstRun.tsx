import { useEffect, useState, type FormEvent } from "react";
import type { KeyValue } from "../auth";
import { rememberWorkspace } from "../newsession";
import { backStep, nextStep, sshTarget, type Servers, type Step, type Where } from "../servers";
import { Button, RadioGroup, Suggest } from "../ui";
import { BrowseButton } from "./BrowseButton";

type SetupState = { state: "idle" } | { state: "busy" } | { state: "done"; id: string } | { state: "failed"; message: string };

export type FirstRunProps = { servers: Servers; welcome: boolean; onClose: () => void; storage?: KeyValue; mac?: boolean };

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function part(step: Step): number {
  return step === "setup" ? 1 : step === "workspace" || step === "done" ? 2 : 0;
}

export function FirstRun({ servers, welcome, onClose, storage, mac }: FirstRunProps) {
  const [step, setStep] = useState<Step>(welcome ? "welcome" : "location");
  const [where, setWhere] = useState<Where>("local");
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [host, setHost] = useState("");
  const [hosts, setHosts] = useState<string[]>([]);
  const [setup, setSetup] = useState<SetupState>({ state: "idle" });
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const here = mac ? "This Mac" : "This computer";

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

  const target = where === "ssh" ? host.trim() : where === "url" ? address.trim() : here;
  const hostBad = where === "ssh" && host.trim() !== "" && sshTarget(host) === null;
  const id = setup.state === "done" ? setup.id : "";

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

  useEffect(() => {
    if (step === "setup" && setup.state === "idle") {
      runSetup();
    }
  });

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

  async function open(workspace: string) {
    setBusy(true);
    setError("");
    try {
      if (workspace) {
        await servers.workspace(id, workspace);
        if (storage) {
          rememberWorkspace(storage, workspace);
        }
      }
      await servers.open(id);
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (step === "workspace") {
      open(path.trim());
    } else if (ready) {
      setStep(nextStep(step, where));
    }
  }

  const doing = where === "local" ? "Starting the crew daemon" : where === "ssh" ? "Setting up crew on " + target + " over SSH" : "Pairing with " + target;
  const done = where === "local" ? "crew daemon started" : where === "ssh" ? "crew set up on " + target : "Paired with " + target;
  const at = part(step);

  return (
    <form className="ob" onSubmit={submit}>
      <div className="ob-body">
        {step === "welcome" ? null : (
          <ol className="ob-progress" aria-label="Progress">
            {[0, 1, 2].map((i) => (
              <li key={i} data-state={i <= at ? "on" : "off"} />
            ))}
          </ol>
        )}
        {step === "welcome" ? (
          <>
            <h1>Welcome to crew</h1>
            <p className="lead">The next steps pick where agents run, set that computer up and add a workspace. Nothing needs sudo.</p>
          </>
        ) : null}
        {step === "location" ? (
          <>
            <h1>Where do agents run?</h1>
            <p className="lead">You can add more servers later in Settings.</p>
            <RadioGroup
              label="Where do agents run?"
              className="where-choices"
              itemClassName="where-choice"
              value={where}
              onChange={choose}
              options={[
                { value: "local" as Where, title: here, detail: "The app starts crew for you." },
                { value: "ssh" as Where, title: "Another computer, over SSH", detail: "Hosts from ~/.ssh/config, key login only." },
                { value: "url" as Where, title: "A paired server", detail: "Its address and a code from crew remote pair." },
              ].map((c) => ({ value: c.value, label: <span className="where-title">{c.title}</span>, detail: <span className="where-detail">{c.detail}</span> }))}
            />
          </>
        ) : null}
        {step === "host" && where === "url" ? (
          <>
            <h1>A paired server</h1>
            <p className="lead">
              Run <code>crew remote pair</code> on the server to get a code.
            </p>
            <div className="ob-fields">
              <label>
                Address
                <input className="ui input" type="text" inputMode="url" autoCapitalize="off" spellCheck={false} placeholder="crew.example.ts.net" value={address} onChange={(e) => setAddress(e.target.value)} />
              </label>
              <label>
                Pairing code
                <input className="ui input mono" type="text" autoCapitalize="characters" spellCheck={false} placeholder="ABCD2345" value={code} onChange={(e) => setCode(e.target.value)} />
              </label>
            </div>
          </>
        ) : null}
        {step === "host" && where === "ssh" ? (
          <>
            <h1>Another computer, over SSH</h1>
            <p className="lead">The app runs crew setup daemon on it, then pairs through an SSH tunnel.</p>
            <div className="ob-fields">
              <label>
                SSH host
                <Suggest label="SSH host" suggestions={hosts} autoCapitalize="off" spellCheck={false} placeholder="user@host" value={host} onChange={setHost} />
              </label>
              {hostBad ? (
                <p className="error" role="alert">
                  Type a host name or user@host. Options and spaces are not allowed.
                </p>
              ) : (
                <p className="ob-note">The hosts come from ~/.ssh/config. The app uses key login only.</p>
              )}
            </div>
          </>
        ) : null}
        {step === "setup" ? (
          <>
            <h1>{where === "url" ? "Pairing with " + target : "Setting up " + (where === "local" ? here.replace("This", "this") : target)}</h1>
            <p className="lead">Nothing needs sudo.</p>
            <ul className="ob-checklist" aria-label="Set up">
              <li>
                {setup.state === "done" ? <span className="ok">✓</span> : setup.state === "failed" ? <span className="bad">✗</span> : <span className="spin" aria-hidden="true" />}
                <span className="grow">{setup.state === "done" ? done : doing}</span>
                {setup.state === "failed" ? (
                  <Button className="sm" onClick={runSetup}>
                    Try again
                  </Button>
                ) : null}
              </li>
            </ul>
            {setup.state === "failed" ? (
              <p className="error" role="alert">
                {setup.message}
              </p>
            ) : null}
          </>
        ) : null}
        {step === "workspace" || step === "done" ? (
          <>
            <h1>{target} is ready</h1>
            <p className="lead">Add the first workspace, or skip and add one later.</p>
            <div className="ob-section">FIRST WORKSPACE</div>
            <div className="ob-path">
              <input className="ui input mono" aria-label="First workspace" type="text" autoCapitalize="off" spellCheck={false} placeholder="~/code/web" value={path} onChange={(e) => setPath(e.target.value)} />
              {where === "local" ? <BrowseButton pick={() => servers.pickFolder()} onPick={setPath} onError={setError} /> : null}
            </div>
            <p className="ob-note">A git repository or a folder of them. It becomes your default project.</p>
          </>
        ) : null}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="ob-buttons">
          {step !== "welcome" && !(step === "location" && !welcome) ? (
            <Button variant="quiet" onClick={() => setStep(backStep(step, where))}>
              Back
            </Button>
          ) : (
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
          )}
          <span className="spacer" />
          {step === "workspace" || step === "done" ? (
            <>
              <Button variant="quiet" disabled={busy} onClick={() => open("")}>
                Skip
              </Button>
              <Button variant="primary" type="submit" disabled={busy || path.trim() === ""}>
                Open crew
              </Button>
            </>
          ) : (
            <Button variant="primary" type="submit" disabled={!ready}>
              {step === "welcome" ? "Get started" : "Continue"}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
