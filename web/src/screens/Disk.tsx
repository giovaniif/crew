import { useCallback, useEffect, useRef, useState } from "react";
import { type Authed, cleanupRun, cleanupWorktree, diskView, killPorts, openShell } from "../api";
import { type DiskAction, type DiskTableRow, type DiskView, diskActions, diskCards, diskPorts, diskRecent, diskRows, killAction, pollDelay } from "../disk";
import { Button, Dialog } from "../ui";
import type { StreamState } from "../stream";

type DiskTab = "worktrees" | "ports" | "recent";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type Pending = { action: DiskAction; worktree: string };

function Confirm({ title, body, verb, busy, error, onCancel, onConfirm }: { title: string; body: string; verb: string; busy: boolean; error: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Dialog title={title} onClose={onCancel}>
      <p>{body}</p>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="dialog-actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="danger" disabled={busy} onClick={onConfirm}>
          {verb}
        </Button>
      </div>
    </Dialog>
  );
}

function Cards({ view }: { view: DiskView }) {
  return (
    <ul className="stats" aria-label="Disk">
      {diskCards(view).map((c) => (
        <li key={c.title} className="card stat">
          <div className="k">{c.title}</div>
          <div className={"v" + (c.title === "Auto-cleanup" ? " small" : "")}>{c.value}</div>
          {c.usage !== null ? (
            <div className="usage">
              <div className="bar-fill" role="meter" aria-label="Volume used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={c.usage}>
                <i style={{ width: c.usage + "%" }} />
              </div>
              <span className="s">{c.sub}</span>
            </div>
          ) : (
            <div className="s">{c.sub}</div>
          )}
        </li>
      ))}
    </ul>
  );
}

const pillTone: Record<string, string> = { green: " ok", peach: " warn", blue: " blue", grey: "" };

function Actions({ row, onAction }: { row: DiskTableRow; onAction: (a: DiskAction, row: DiskTableRow) => void }) {
  return (
    <span className="disk-actions">
      {diskActions(row).map((a) => (
        <Button key={a.title} variant="quiet" className="row-action" onClick={() => onAction(a, row)}>
          {a.title}
        </Button>
      ))}
    </span>
  );
}

export function Disk({ api, state, now, go }: { api: Authed; state: StreamState | null; now: number; go: (hash: string) => void }) {
  const [view, setView] = useState<DiskView | null>(null);
  const [tab, setTab] = useState<DiskTab>("worktrees");
  const [cleaning, setCleaning] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [note, setNote] = useState("");
  const [failure, setFailure] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    let next: DiskView | null = null;
    try {
      next = await diskView(api);
      if (!alive.current) {
        return;
      }
      setView(next);
      setLoadError("");
    } catch (err) {
      if (!alive.current) {
        return;
      }
      setLoadError(errorText(err));
    }
    timer.current = setTimeout(() => void load(), pollDelay(next));
  }, [api]);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, [load]);

  const onAction = async (action: DiskAction, row: { worktree: string; sessionID?: string; path?: string }) => {
    setNote("");
    setFailure("");
    if (action.kind === "session" && row.sessionID) {
      go("#/sessions/" + encodeURIComponent(row.sessionID));
      return;
    }
    if (action.kind === "shell" && row.sessionID && row.path) {
      try {
        await openShell(api, row.sessionID, row.path);
        go("#/sessions/" + encodeURIComponent(row.sessionID) + "/shell");
      } catch (err) {
        setFailure(errorText(err));
      }
      return;
    }
    if (action.kind === "copy" && action.path) {
      try {
        await navigator.clipboard.writeText(action.path);
        setNote("Copied " + action.path);
      } catch {
        setNote(action.path);
      }
      return;
    }
    setActionError("");
    setPending({ action, worktree: row.worktree });
  };

  const confirm = async () => {
    if (!pending) {
      return;
    }
    setBusy(true);
    setActionError("");
    try {
      const a = pending.action;
      if (a.cleanup) {
        const item = await cleanupWorktree(api, a.cleanup.path, a.cleanup.backup);
        setNote(pending.worktree + ": " + (item.outcome || item.reason));
      } else {
        const out = await killPorts(api, a.pgids);
        setNote("Stopped " + out.killed.length + (out.killed.length === 1 ? " process group" : " process groups"));
      }
      setPending(null);
      void load();
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const cleanNow = async () => {
    setBusy(true);
    setActionError("");
    try {
      const out = await cleanupRun(api);
      const n = out.items.length;
      setNote(n === 0 ? "Nothing to clean up." : "Cleaned " + n + (n === 1 ? " worktree" : " worktrees"));
      setCleaning(false);
      void load();
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const sessions = state?.sessions ?? [];
  const rows = view ? diskRows(view, state ? { worktrees: state.worktrees, sessions } : null) : [];
  const ports = view ? diskPorts(view.ports ?? [], sessions) : [];
  const recent = view ? diskRecent(view, now) : [];

  const tabs: { id: DiskTab; title: string }[] = [
    { id: "worktrees", title: view ? "Worktrees " + rows.length : "Worktrees" },
    { id: "ports", title: view ? "Dev servers " + ports.length : "Dev servers" },
    { id: "recent", title: "Recently cleaned" },
  ];

  return (
    <div className="screen disk">
      <header className="page-head">
        <h1>Worktrees and disk</h1>
        <span className="spacer" />
        <Button onClick={() => (setActionError(""), setCleaning(true))}>Clean up now</Button>
      </header>
      {loadError ? (
        <p className="error" role="alert">
          {loadError}
        </p>
      ) : null}
      {failure ? (
        <p className="error" role="alert">
          {failure}
        </p>
      ) : null}
      {note ? (
        <p className="disk-note" role="status">
          {note}
        </p>
      ) : null}
      {view ? <Cards view={view} /> : <p className="muted">Loading…</p>}
      <div className="subtabs disk-tabs" role="tablist" aria-label="Disk views">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" id={"disk-tab-" + t.id} aria-controls={"disk-pane-" + t.id} aria-selected={t.id === tab} className={t.id === tab ? "on" : undefined} onClick={() => setTab(t.id)}>
            {t.title}
          </button>
        ))}
      </div>
      <section className="disk-pane" role="tabpanel" id={"disk-pane-" + tab} aria-labelledby={"disk-tab-" + tab}>
        {tab === "worktrees" ? (
          rows.length === 0 ? (
            <p className="muted">{view ? "No worktrees." : ""}</p>
          ) : (
            <table className="table disk-table disk-wt">
              <thead>
                <tr>
                  <th scope="col">Worktree</th>
                  <th scope="col">Session</th>
                  <th scope="col">PR</th>
                  <th scope="col">State</th>
                  <th scope="col" className="num">Size</th>
                  <th scope="col">Ports</th>
                  <th scope="col">Cleanup</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono clip" title={r.worktree}>{r.worktree}</td>
                    <td className="clip" title={r.session}>{r.session}</td>
                    <td>{r.pr}</td>
                    <td>
                      <span className={"pill" + (pillTone[r.tone] ?? "")}>{r.status}</span>
                    </td>
                    <td className="num">{r.size}</td>
                    <td className="mono dim">{r.ports}</td>
                    <td className="muted clip" title={r.detail || r.plan}>{r.plan}</td>
                    <td>
                      <Actions row={r} onAction={(a, row) => void onAction(a, row)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : null}
        {tab === "ports" ? (
          ports.length === 0 ? (
            <p className="muted">No dev servers are listening.</p>
          ) : (
            <table className="table disk-table disk-ports">
              <thead>
                <tr>
                  <th scope="col">Port</th>
                  <th scope="col">Command</th>
                  <th scope="col">Worktree</th>
                  <th scope="col">Session</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ports.map((p) => (
                  <tr key={p.key}>
                    <td className="mono">:{p.port}</td>
                    <td className="mono clip" title={p.command}>{p.command}</td>
                    <td className="mono clip" title={p.worktree}>{p.worktree}</td>
                    <td>{p.session}</td>
                    <td>
                      <Button variant="quiet" className="row-action disk-kill" onClick={() => void onAction(killAction(p), p)}>
                        Stop…
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : null}
        {tab === "recent" ? (
          recent.length === 0 ? (
            <p className="muted">Nothing was cleaned yet.</p>
          ) : (
            <table className="table disk-table disk-recent">
              <thead>
                <tr>
                  <th scope="col">Worktree</th>
                  <th scope="col">Branch</th>
                  <th scope="col">When</th>
                  <th scope="col">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.key}>
                    <td className="mono clip" title={r.worktree}>{r.worktree}</td>
                    <td className="mono clip" title={r.branch}>{r.branch}</td>
                    <td>{r.when}</td>
                    <td className="clip" title={r.outcome}>{r.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : null}
      </section>
      {pending ? <Confirm title={pending.action.title.replace("…", "")} body={pending.action.confirm ?? ""} verb={pending.action.verb} busy={busy} error={actionError} onCancel={() => setPending(null)} onConfirm={() => void confirm()} /> : null}
      {cleaning ? (
        <Confirm
          title="Clean up now"
          body="Run the cleanup now? crew removes the worktrees that the plan marks for removal, and backs up uncommitted work first. The branches stay."
          verb="Clean up"
          busy={busy}
          error={actionError}
          onCancel={() => setCleaning(false)}
          onConfirm={() => void cleanNow()}
        />
      ) : null}
    </div>
  );
}
