import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { ApiError, type Automation, type AutomationRun, type Authed, automationRuns, listAutomations, rerunAutomation, runAutomation, saveAutomation } from "../api";
import { automationOf, automationRows, draftOf, newDraft, repoSource, runDuration, runLabel, runsOf, sinceLabel, type AutomationDraft, type AutomationQuery } from "../automations";
import { Button, Checkbox, Menu, Select, Switch } from "../ui";

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

function tone(outcome: string): string {
  return outcome === "succeeded" ? " ok" : outcome === "failed" ? " bad" : "";
}

function dot(outcome: string): string {
  return outcome === "succeeded" ? " ok" : outcome === "failed" ? " ask" : "";
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
      <label className="field">
        Context
        <textarea className="ui input area" value={context} onChange={(e) => setContext(e.target.value)} rows={4} />
      </label>
      <label className="field">
        Work item
        <input className="ui input" value={workItem} onChange={(e) => setWorkItem(e.target.value)} />
      </label>
      <div className="run-actions">
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy}>
          Run
        </Button>
      </div>
      {note && <p role="status">{note}</p>}
    </form>
  );
}

function History({ api, name, runs, onRan }: { api: Authed; name: string; runs: AutomationRun[]; onRan: (run: AutomationRun) => void }) {
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
      <ul className="run-list" aria-label={"Run history of " + name}>
        {runs.map((r) => (
          <li key={r.id} className="li">
            <span className={"dot" + dot(r.outcome)} aria-hidden="true" />
            <span className="grow">
              <span className={"pill" + tone(r.outcome)}>{r.outcome}</span> {when(r.start)} {r.trigger ? <span className="muted">{r.trigger}</span> : null}
              {r.reason ? <span className="muted"> · {r.reason}</span> : null}
            </span>
            {r.session_id ? <a href={"#/sessions/" + encodeURIComponent(r.session_id)}>Open session</a> : null}
            <button type="button" className="link" onClick={() => rerun(r.id)}>
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
    <label className="field">
      {label}
      {multi ? <textarea className="ui input area" rows={5} value={value} onChange={(e) => onChange(e.target.value)} /> : <input className="ui input" type="text" value={value} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}

function EditForm({ api, title, initial, fixedName, taken = [], onSaved, onCancel }: { api: Authed; title: string; initial: AutomationDraft; fixedName: boolean; taken?: string[]; onSaved: () => void; onCancel: () => void }) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const set = (key: keyof AutomationDraft) => (v: string) => setD({ ...d, [key]: v });
  const nameTaken = !fixedName && taken.includes(d.name.trim());

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
      {fixedName ? null : <Field label="Name" value={d.name} onChange={set("name")} />}
      {nameTaken ? <p className="mate-error">An automation named {d.name.trim()} exists.</p> : null}
      {d.mate ? <p className="muted">Runs as the mate {d.mate}.</p> : null}
      <div className="ui-field field">
        Agent
        <Select label="Agent" value={d.agent} onChange={(agent) => setD({ ...d, agent })} options={["claude", "codex", "omp"].map((a) => ({ value: a, label: a }))} />
      </div>
      <Field label="Model" value={d.model} onChange={set("model")} />
      <Field label="Effort" value={d.effort} onChange={set("effort")} />
      <Field label="Target" value={d.target} onChange={set("target")} />
      <Field label="Prompt" value={d.prompt} onChange={set("prompt")} multi />
      <Field label="Schedule" value={d.schedule} onChange={set("schedule")} />
      <Field label="Timezone" value={d.timezone} onChange={set("timezone")} />
      <Field label="Events (comma separated)" value={d.on} onChange={set("on")} />
      <Field label="Precheck" value={d.precheck} onChange={set("precheck")} />
      <Field label="Session" value={d.session} onChange={set("session")} />
      <Checkbox label="Enabled" checked={d.enabled} onChange={(enabled) => setD({ ...d, enabled })} />
      {note ? <p role="alert">{note}</p> : null}
      <div className="run-actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy || nameTaken || !d.name.trim() || !d.prompt.trim()}>
          Save
        </Button>
      </div>
    </form>
  );
}

function sessionText(s: string | undefined): string {
  return !s || s === "fresh" ? "new each run" : s;
}

function Detail({ api, automation, runs, now, onRan, onSaved }: { api: Authed; automation: Automation; runs: AutomationRun[]; now: number; onRan: (run: AutomationRun) => void; onSaved: () => void }) {
  const [tab, setTab] = useState<"details" | "history">("details");
  const [mode, setMode] = useState<"view" | "edit" | "run">("view");
  const repo = repoSource(automation);
  const id = "automation-" + automation.name;
  const facts: [string, string | undefined, boolean][] = [
    ["Trigger", trigger(automation), true],
    ["Timezone", automation.timezone, false],
    ["Agent", [automation.agent, automation.model, automation.effort].filter(Boolean).join(" · "), false],
    ["Target", automation.target, true],
    ["Precheck", automation.precheck, true],
    ["Session", sessionText(automation.session), false],
  ];
  return (
    <aside className="auto-detail" aria-label={automation.name}>
      <div className="detail-head">
        <b>{automation.name}</b>
        <span className="spacer" />
        <Button className="small" onClick={() => setMode(mode === "run" ? "view" : "run")}>
          Run now
        </Button>
        {repo ? null : (
          <Button className="small" onClick={() => setMode("edit")}>
            Edit
          </Button>
        )}
      </div>
      {mode === "run" ? <RunForm api={api} automation={automation} onDone={() => setMode("view")} onRan={onRan} /> : null}
      {mode === "edit" ? (
        <EditForm api={api} title={"Edit " + automation.name} initial={draftOf(automation)} fixedName onCancel={() => setMode("view")} onSaved={() => (setMode("view"), onSaved())} />
      ) : (
        <>
          <div role="tablist" className="subtabs" aria-label={"Views of " + automation.name}>
            <button type="button" role="tab" id={id + "-details"} className={tab === "details" ? "on" : undefined} aria-selected={tab === "details"} onClick={() => setTab("details")}>
              Details
            </button>
            <button type="button" role="tab" id={id + "-history"} className={tab === "history" ? "on" : undefined} aria-selected={tab === "history"} onClick={() => setTab("history")}>
              History
            </button>
          </div>
          {tab === "details" ? (
            <div role="tabpanel" aria-labelledby={id + "-details"}>
              <dl className="kv">
                {facts
                  .filter(([, v]) => v)
                  .map(([k, v, mono]) => (
                    <div key={k} className="fact">
                      <dt id={id + "-k-" + k}>{k}</dt>
                      <dd aria-labelledby={id + "-k-" + k} className={mono ? "mono" : undefined}>
                        {v}
                      </dd>
                    </div>
                  ))}
              </dl>
              <div className="section-title">PROMPT</div>
              <pre className="automation-prompt">{automation.prompt}</pre>
              <p className="muted source">
                Defined in <code>{automation.source}</code>.{repo ? " Change it in that file in the repo." : ""}
              </p>
              <div className="section-title">RECENT RUNS</div>
              {runs.length === 0 ? (
                <p className="muted">No runs yet.</p>
              ) : (
                <ul className="run-list" aria-label={"Recent runs of " + automation.name}>
                  {runs.slice(0, 5).map((r) => (
                    <li key={r.id} className="li">
                      <span className={"dot" + dot(r.outcome)} aria-hidden="true" />
                      <span className="grow">{runLabel(r.start, now) || r.outcome}</span>
                      <span className="muted">{r.reason || runDuration(r.start, r.end) || r.outcome}</span>
                      {r.session_id ? <a href={"#/sessions/" + encodeURIComponent(r.session_id)}>Open</a> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div role="tabpanel" aria-labelledby={id + "-history"}>
              <History api={api} name={automation.name} runs={runs} onRan={onRan} />
            </div>
          )}
        </>
      )}
    </aside>
  );
}

type ChipOption = { value: string; label: string };

function FilterChip({ name, value, options, onChange }: { name: string; value: string; options: ChipOption[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) {
      return;
    }
    const away = (e: MouseEvent) => {
      if (!anchor.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    <span ref={anchor} className="ui-anchor">
      <button ref={button} type="button" className="chip" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {name}: {current.label}
        <span className="chev" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <Menu
          label={name}
          items={options.map((o) => ({ value: o.value, label: o.label, checked: o.value === value }))}
          onPick={(v) => {
            close();
            onChange(v);
          }}
          onClose={close}
        />
      ) : null}
    </span>
  );
}

const noQuery: AutomationQuery = { search: "", enabled: null, outcome: null, agent: null, sort: "name" };

function SortHead({ title, sort, query, setQuery }: { title: string; sort: AutomationQuery["sort"]; query: AutomationQuery; setQuery: (q: AutomationQuery) => void }) {
  const on = query.sort === sort;
  return (
    <th scope="col" aria-sort={on ? (sort === "name" ? "ascending" : "descending") : undefined}>
      <button type="button" className={"sort" + (on ? " on" : "")} onClick={() => setQuery({ ...query, sort })}>
        {title}
      </button>
    </th>
  );
}

export function Automations({ api, now = Date.now(), forMate }: { api: Authed; now?: number; forMate?: string }) {
  const [list, setList] = useState<Automation[] | null>(null);
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [selected, setSelected] = useState("");
  const [creating, setCreating] = useState(forMate !== undefined);
  const [query, setQuery] = useState<AutomationQuery>(noQuery);
  const [round, setRound] = useState(0);
  const [toggleError, setToggleError] = useState("");

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
  const chosen = creating ? null : (list ?? []).find((a) => a.name === selected) ?? null;

  const toggle = async (a: Automation, enabled: boolean) => {
    setToggleError("");
    try {
      await saveAutomation(api, automationOf({ ...draftOf(a), enabled }));
      reload();
    } catch (err) {
      setToggleError(failure(err));
    }
  };

  const choose = (name: string) => {
    setCreating(false);
    setSelected(name);
  };

  const onRowKey = (e: KeyboardEvent, name: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(name);
    }
  };

  return (
    <main className={"screen automations" + (chosen || creating ? " with-detail" : "")}>
      <div className="page">
        <div className="page-head">
          <h1>Automations</h1>
          {list !== null ? (
            <span className="sub" aria-label={list.length + " automations"}>
              {list.length}
            </span>
          ) : null}
          <span className="spacer" />
          <Button variant="primary" onClick={() => (setSelected(""), setCreating(true))}>
            New automation
          </Button>
        </div>
        <div className="filters">
          <FilterChip
            name="State"
            value={query.enabled === null ? "" : String(query.enabled)}
            onChange={(v) => setQuery({ ...query, enabled: v === "" ? null : v === "true" })}
            options={[
              { value: "", label: "All" },
              { value: "true", label: "Enabled" },
              { value: "false", label: "Paused" },
            ]}
          />
          <FilterChip
            name="Last run"
            value={query.outcome ?? ""}
            onChange={(v) => setQuery({ ...query, outcome: v || null })}
            options={[
              { value: "", label: "Any" },
              { value: "succeeded", label: "Succeeded" },
              { value: "failed", label: "Failed" },
              { value: "skipped", label: "Skipped" },
              { value: "never", label: "Never run" },
            ]}
          />
          <FilterChip name="Agent" value={query.agent ?? ""} onChange={(v) => setQuery({ ...query, agent: v || null })} options={[{ value: "", label: "All" }, ...agents.map((a) => ({ value: a, label: a }))]} />
          <span className="spacer" />
          <input className="ui input search" type="search" placeholder="Search" aria-label="Search automations" value={query.search} onChange={(e) => setQuery({ ...query, search: e.target.value })} />
        </div>
        {error && <p role="alert">{error}</p>}
        {toggleError && <p role="alert">{toggleError}</p>}
        {problems.map((p) => (
          <p key={p} className="automation-problem">
            {p}
          </p>
        ))}
        {list === null && !error && <p>Loading…</p>}
        {list !== null && list.length === 0 && <p>No automations. Add [[automation]] tables to config.toml on the server.</p>}
        {list !== null && list.length > 0 && rows.length === 0 && <p className="muted">No automation matches.</p>}
        {rows.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <SortHead title="Name" sort="name" query={query} setQuery={setQuery} />
                  <th scope="col">Trigger</th>
                  <th scope="col">Agent</th>
                  <SortHead title="Last run" sort="lastRun" query={query} setQuery={setQuery} />
                  <th scope="col" className="switch-col">
                    <span className="visually-hidden">Enabled</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ automation: a, last }) => {
                  const on = chosen?.name === a.name;
                  const quiet = a.enabled ? "" : " muted";
                  return (
                    <tr key={a.source + a.name} aria-label={a.name} aria-selected={on} tabIndex={0} className={on ? "on" : undefined} onClick={() => choose(a.name)} onKeyDown={(e) => onRowKey(e, a.name)}>
                      <td className={a.enabled ? "name" : "name muted"}>{a.name}</td>
                      <td className={"mono" + (quiet || " dim")}>{trigger(a)}</td>
                      <td className={quiet || "dim"}>{a.agent}</td>
                      <td className="last">
                        {last ? (
                          <>
                            <span className={"pill" + tone(last.outcome)}>{last.outcome}</span> <span className="muted">{sinceLabel(last.start, now)}</span>
                          </>
                        ) : (
                          <span className="muted">Never run</span>
                        )}
                      </td>
                      <td className="switch-col" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        <Switch label={null} ariaLabel={"Enable " + a.name} checked={a.enabled} disabled={repoSource(a) !== null} onChange={(v) => void toggle(a, v)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
      {creating ? (
        <aside className="auto-detail" aria-label="New automation">
          <div className="detail-head">
            <b>New automation</b>
          </div>
          <EditForm api={api} title="New automation" initial={newDraft(forMate ?? "")} fixedName={false} taken={(list ?? []).map((a) => a.name)} onCancel={() => setCreating(false)} onSaved={() => (setCreating(false), reload())} />
        </aside>
      ) : null}
      {chosen ? <Detail key={chosen.name} api={api} automation={chosen} runs={runsOf(chosen.name, runs)} now={now} onRan={ran} onSaved={reload} /> : null}
    </main>
  );
}
