import { type FormEvent, useEffect, useState } from "react";
import { ApiError, type Automation, type AutomationRun, type Authed, automationRuns, listAutomations, rerunAutomation, runAutomation, saveAutomation } from "../api";
import { automationOf, automationRows, draftOf, newDraft, repoSource, runsOf, type AutomationDraft, type AutomationQuery } from "../automations";

function trigger(a: Automation): string {
  const parts: string[] = [];
  if (a.schedule) {
    parts.push(a.schedule);
  }
  if (a.on && a.on.length > 0) {
    parts.push("on " + a.on.join(", "));
  }
  return parts.length > 0 ? parts.join(" · ") : "manual";
}

function lastRun(run: AutomationRun | undefined): string {
  if (!run) {
    return "never run";
  }
  return "last run " + run.outcome + (run.reason ? ": " + run.reason : "");
}

function when(start: string | undefined): string {
  if (!start) {
    return "";
  }
  const at = new Date(start);
  if (Number.isNaN(at.getTime())) {
    return "";
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function History({ name, runs }: { name: string; runs: AutomationRun[] }) {
  if (runs.length === 0) {
    return <p className="muted">No runs yet.</p>;
  }
  return (
    <ul className="runs" aria-label={"Runs of " + name}>
      {runs.map((r) => (
        <li key={r.id}>
          <span className={"outcome-" + r.outcome}>{r.outcome}</span>
          {r.trigger ? <span>{r.trigger}</span> : null}
          {when(r.start) ? <span>{when(r.start)}</span> : null}
          {r.reason ? <span>{r.reason}</span> : null}
          {r.session_id ? <a className="open-session" href={"#/sessions/" + encodeURIComponent(r.session_id)}>Open session</a> : null}
        </li>
      ))}
    </ul>
  );
}

function RunForm({ api, automation, onDone, onRan }: { api: Authed; automation: Automation; onDone: () => void; onRan: (run: AutomationRun) => void }) {
  const [context, setContext] = useState("");
  const [workItem, setWorkItem] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote("");
    try {
      const out = await runAutomation(api, automation.name, { context, work_item: workItem });
      onRan(out.run);
      if (out.run.session_id) {
        window.location.hash = "#/sessions/" + encodeURIComponent(out.run.session_id);
        return;
      }
      setNote(out.run.outcome + (out.run.reason ? ": " + out.run.reason : ""));
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="run-form" onSubmit={submit}>
      <label>
        Context
        <textarea value={context} onChange={(e) => setContext(e.target.value)} rows={4} />
      </label>
      <label>
        Work item
        <input value={workItem} onChange={(e) => setWorkItem(e.target.value)} />
      </label>
      <div className="run-actions">
        <button type="button" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" disabled={busy}>
          Run
        </button>
      </div>
      {note && <p role="status">{note}</p>}
    </form>
  );
}

function failure(err: unknown): string {
  if (err instanceof ApiError && err.code === "forbidden") {
    return "Only the owner device, the app on the computer that runs crew, can change automations.";
  }
  if (err instanceof ApiError && err.code === "unknown_method") {
    return "This server cannot do this. Update crew on the server.";
  }
  return err instanceof Error ? err.message : String(err);
}

function Runs({ api, name, runs, onRan }: { api: Authed; name: string; runs: AutomationRun[]; onRan: (run: AutomationRun) => void }) {
  const [note, setNote] = useState("");
  if (runs.length === 0) {
    return <p className="muted">No runs yet.</p>;
  }
  const rerun = async (id: string) => {
    setNote("");
    try {
      const out = await rerunAutomation(api, id);
      onRan(out.run);
      if (out.run.session_id) {
        window.location.hash = "#/sessions/" + encodeURIComponent(out.run.session_id);
        return;
      }
      setNote(out.run.outcome + (out.run.reason ? ": " + out.run.reason : ""));
    } catch (err) {
      setNote(failure(err));
    }
  };
  return (
    <>
      <ul className="runs" aria-label={"Run history of " + name}>
        {runs.map((r) => (
          <li key={r.id}>
            <span className={"outcome-" + r.outcome}>{r.outcome}</span>
            {r.trigger ? <span>{r.trigger}</span> : null}
            {when(r.start) ? <span>{when(r.start)}</span> : null}
            {r.reason ? <span>{r.reason}</span> : null}
            {r.session_id ? (
              <a className="open-session" href={"#/sessions/" + encodeURIComponent(r.session_id)}>
                Open session
              </a>
            ) : null}
            <button type="button" className="rerun" onClick={() => rerun(r.id)}>
              Rerun
            </button>
          </li>
        ))}
      </ul>
      {note ? <p role="alert">{note}</p> : null}
    </>
  );
}

function Field({ label, value, onChange, multi }: { label: string; value: string; onChange: (v: string) => void; multi?: boolean }) {
  return (
    <label>
      {label}
      {multi ? <textarea rows={5} value={value} onChange={(e) => onChange(e.target.value)} /> : <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}

function EditForm({ api, title, initial, fixedName, onSaved, onCancel }: { api: Authed; title: string; initial: AutomationDraft; fixedName: boolean; onSaved: () => void; onCancel: () => void }) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const set = (key: keyof AutomationDraft) => (v: string) => setD({ ...d, [key]: v });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote("");
    try {
      await saveAutomation(api, automationOf(d));
      onSaved();
    } catch (err) {
      setNote(failure(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="automation-form" aria-label={title} onSubmit={submit}>
      <h2>{title}</h2>
      {fixedName ? null : <Field label="Name" value={d.name} onChange={set("name")} />}
      <label>
        Agent
        <select value={d.agent} onChange={(e) => setD({ ...d, agent: e.target.value })}>
          {["claude", "codex", "omp"].map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <Field label="Model" value={d.model} onChange={set("model")} />
      <Field label="Effort" value={d.effort} onChange={set("effort")} />
      <Field label="Target" value={d.target} onChange={set("target")} />
      <Field label="Prompt" value={d.prompt} onChange={set("prompt")} multi />
      <Field label="Schedule" value={d.schedule} onChange={set("schedule")} />
      <Field label="Timezone" value={d.timezone} onChange={set("timezone")} />
      <Field label="Events (comma separated)" value={d.on} onChange={set("on")} />
      <Field label="Precheck" value={d.precheck} onChange={set("precheck")} />
      <Field label="Session" value={d.session} onChange={set("session")} />
      <label className="check">
        <input type="checkbox" checked={d.enabled} onChange={(e) => setD({ ...d, enabled: e.target.checked })} />
        Enabled
      </label>
      {note ? <p role="alert">{note}</p> : null}
      <div className="run-actions">
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={busy || !d.name.trim() || !d.prompt.trim()}>
          Save
        </button>
      </div>
    </form>
  );
}

function Detail({ api, automation, runs, onRan, onSaved }: { api: Authed; automation: Automation; runs: AutomationRun[]; onRan: (run: AutomationRun) => void; onSaved: () => void }) {
  const [tab, setTab] = useState<"overview" | "runs">("overview");
  const [editing, setEditing] = useState(false);
  const repo = repoSource(automation);
  const id = "automation-" + automation.name;
  const facts: [string, string | undefined][] = [
    ["Agent", automation.agent],
    ["Model", automation.model],
    ["Effort", automation.effort],
    ["Target", automation.target],
    ["Trigger", trigger(automation)],
    ["Timezone", automation.timezone],
    ["Precheck", automation.precheck],
    ["Session", automation.session],
    ["State", automation.enabled ? "enabled" : "paused"],
  ];
  return (
    <section className="automation-detail" aria-label={automation.name}>
      <div role="tablist" className="detail-tabs" aria-label={"Views of " + automation.name}>
        <button type="button" role="tab" id={id + "-overview"} aria-selected={tab === "overview"} onClick={() => setTab("overview")}>
          Overview
        </button>
        <button type="button" role="tab" id={id + "-runs"} aria-selected={tab === "runs"} onClick={() => setTab("runs")}>
          Runs
        </button>
      </div>
      {tab === "overview" ? (
        <div role="tabpanel" aria-labelledby={id + "-overview"}>
          {editing ? (
            <EditForm api={api} title={"Edit " + automation.name} initial={draftOf(automation)} fixedName onCancel={() => setEditing(false)} onSaved={() => (setEditing(false), onSaved())} />
          ) : (
            <>
              <dl className="server">
                {facts
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k} className="fact">
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
              </dl>
              <pre className="automation-prompt">{automation.prompt}</pre>
              {repo ? (
                <p className="muted">
                  Defined in <code>{repo}</code>. Change it in that file in the repo.
                </p>
              ) : (
                <>
                  <p className="muted">
                    Defined in <code>{automation.source}</code>.
                  </p>
                  <button type="button" onClick={() => setEditing(true)}>
                    Edit
                  </button>
                </>
              )}
            </>
          )}
        </div>
      ) : (
        <div role="tabpanel" aria-labelledby={id + "-runs"}>
          <Runs api={api} name={automation.name} runs={runs} onRan={onRan} />
        </div>
      )}
    </section>
  );
}

const noQuery: AutomationQuery = { search: "", enabled: null, outcome: null, agent: null, sort: "name" };

export function Automations({ api }: { api: Authed }) {
  const [list, setList] = useState<Automation[] | null>(null);
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [running, setRunning] = useState("");
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [open, setOpen] = useState("");
  const [detail, setDetail] = useState("");
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState<AutomationQuery>(noQuery);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    listAutomations(api)
      .then((out) => {
        if (!live) return;
        setList(out.automations ?? []);
        setProblems(out.problems ?? []);
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : String(err)));
    automationRuns(api)
      .then((out) => live && setRuns(out.runs ?? []))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api, round]);

  const ran = (run: AutomationRun) => setRuns((prev) => [run, ...prev.filter((r) => r.id !== run.id)]);
  const reload = () => setRound((n) => n + 1);
  const agents = Array.from(new Set((list ?? []).map((a) => a.agent))).sort();
  const rows = automationRows(list ?? [], runs, query);

  return (
    <main className="screen automations">
      <div className="automations-head">
        <h1>Automations</h1>
        <button type="button" onClick={() => setCreating(true)}>
          New automation
        </button>
      </div>
      {creating ? (
        <EditForm api={api} title="New automation" initial={newDraft()} fixedName={false} onCancel={() => setCreating(false)} onSaved={() => (setCreating(false), reload())} />
      ) : null}
      <div className="automation-filters">
        <label>
          Search automations
          <input type="search" value={query.search} onChange={(e) => setQuery({ ...query, search: e.target.value })} />
        </label>
        <label>
          State
          <select value={query.enabled === null ? "" : String(query.enabled)} onChange={(e) => setQuery({ ...query, enabled: e.target.value === "" ? null : e.target.value === "true" })}>
            <option value="">All</option>
            <option value="true">Enabled</option>
            <option value="false">Paused</option>
          </select>
        </label>
        <label>
          Last outcome
          <select value={query.outcome ?? ""} onChange={(e) => setQuery({ ...query, outcome: e.target.value || null })}>
            <option value="">Any</option>
            <option value="succeeded">Succeeded</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped</option>
            <option value="never">Never run</option>
          </select>
        </label>
        <label>
          Agent
          <select value={query.agent ?? ""} onChange={(e) => setQuery({ ...query, agent: e.target.value || null })}>
            <option value="">All</option>
            {agents.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort
          <select value={query.sort} onChange={(e) => setQuery({ ...query, sort: e.target.value as AutomationQuery["sort"] })}>
            <option value="name">Name</option>
            <option value="lastRun">Last run</option>
          </select>
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      {problems.map((p) => (
        <p key={p} className="automation-problem">
          {p}
        </p>
      ))}
      {list === null && !error && <p>Loading…</p>}
      {list !== null && list.length === 0 && <p>No automations. Add [[automation]] tables to config.toml on the server.</p>}
      {list !== null && list.length > 0 && rows.length === 0 && <p className="muted">No automation matches.</p>}
      <ul>
        {rows.map(({ automation: a }) => {
          const mine = runsOf(a.name, runs);
          return (
            <li key={a.source + a.name} aria-label={a.name}>
              <div className="automation-row">
                <strong>{a.name}</strong>
                <span>{a.agent}</span>
                <span>{trigger(a)}</span>
                <span>{a.enabled ? "enabled" : "paused"}</span>
                <button type="button" aria-label={"Run " + a.name} onClick={() => setRunning(a.name)}>
                  Run with context
                </button>
              </div>
              <div className="automation-meta">
                <span className={mine[0]?.outcome === "failed" ? "outcome-failed" : undefined}>{lastRun(mine[0])}</span>
                <button type="button" className="history" aria-label={"History of " + a.name} aria-expanded={open === a.name} onClick={() => setOpen(open === a.name ? "" : a.name)}>
                  History
                </button>
                <button type="button" className="history" aria-label={"Details of " + a.name} aria-expanded={detail === a.name} onClick={() => setDetail(detail === a.name ? "" : a.name)}>
                  Details
                </button>
              </div>
              {open === a.name && <History name={a.name} runs={mine} />}
              {detail === a.name && <Detail api={api} automation={a} runs={mine} onRan={ran} onSaved={reload} />}
              {running === a.name && <RunForm api={api} automation={a} onDone={() => setRunning("")} onRan={ran} />}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
