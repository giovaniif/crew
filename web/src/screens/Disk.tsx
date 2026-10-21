import { useCallback, useEffect, useRef, useState } from "react";
import { type Authed, cleanupWorktree, diskView, killPorts, openShell } from "../api";
import { type DiskAction, type DiskTableRow, type DiskView, diskActions, diskPorts, diskRecent, diskRows, diskTiles, killAction, pollDelay } from "../disk";
import type { StreamState } from "../stream";

type DiskTab = "worktrees" | "ports" | "recent";

const tabs: { id: DiskTab; title: string }[] = [
  { id: "worktrees", title: "Worktrees" },
  { id: "ports", title: "Ports" },
  { id: "recent", title: "Recently cleaned" },
];

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type Pending = { action: DiskAction; worktree: string };

function Confirm({ pending, busy, error, onCancel, onConfirm }: { pending: Pending; busy: boolean; error: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="disk-confirm-title" aria-describedby="disk-confirm-body">
        <h2 id="disk-confirm-title">{pending.action.title.replace("…", "")}</h2>
        <p id="disk-confirm-body">{pending.action.confirm}</p>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="secondary" autoFocus onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="danger" disabled={busy} onClick={onConfirm}>
            {pending.action.verb}
          </button>
        </div>
      </div>
    </div>
  );
}

function Tiles({ view }: { view: DiskView }) {
  const t = diskTiles(view);
  const items: [string, string, string][] = [
    ["Volume", t.free, ""],
    ["Worktrees", t.worktrees, ""],
    ["Reclaimable", t.reclaimable, " tone-green"],
  ];
  if (t.depsStore !== null) {
    items.push(["Shared deps store", t.depsStore, ""]);
  }
  items.push(["Auto-cleanup", t.schedule, ""]);
  return (
    <ul className="disk-tiles" aria-label="Disk">
      {items.map(([title, value, tone]) => (
        <li key={title} className="disk-tile">
          <span className="disk-tile-title">{title}</span>
          <span className={"disk-tile-value" + tone}>{value}</span>
        </li>
      ))}
    </ul>
  );
}

function Actions({ row, onAction }: { row: DiskTableRow; onAction: (a: DiskAction, row: DiskTableRow) => void }) {
  return (
    <span className="disk-actions">
      {diskActions(row).map((a) => (
        <button key={a.title} type="button" className={a.confirm ? "disk-danger" : "disk-button"} onClick={() => onAction(a, row)}>
          {a.title}
        </button>
      ))}
    </span>
  );
}

export function Disk({ api, state, now, go }: { api: Authed; state: StreamState | null; now: number; go: (hash: string) => void }) {
  const [view, setView] = useState<DiskView | null>(null);
  const [tab, setTab] = useState<DiskTab>("worktrees");
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

  const sessions = state?.sessions ?? [];
  const rows = view ? diskRows(view, state ? { worktrees: state.worktrees, sessions } : null) : [];
  const ports = view ? diskPorts(view.ports ?? [], sessions) : [];
  const recent = view ? diskRecent(view, now) : [];

  return (
    <div className="screen disk">
      <header className="disk-head">
        <h1>Worktrees and disk</h1>
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
      {view ? <Tiles view={view} /> : <p className="muted">Loading…</p>}
      <div className="disk-tabs" role="tablist" aria-label="Disk views">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" id={"disk-tab-" + t.id} aria-controls={"disk-pane-" + t.id} aria-selected={t.id === tab} onClick={() => setTab(t.id)}>
            {t.title}
          </button>
        ))}
      </div>
      <section className="disk-pane" role="tabpanel" id={"disk-pane-" + tab} aria-labelledby={"disk-tab-" + tab}>
        {tab === "worktrees" ? (
          rows.length === 0 ? (
            <p className="muted">{view ? "No worktrees." : ""}</p>
          ) : (
            <table className="disk-table">
              <thead>
                <tr>
                  <th scope="col">Worktree</th>
                  <th scope="col">Session</th>
                  <th scope="col">PR</th>
                  <th scope="col">State</th>
                  <th scope="col">Size</th>
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
                    <td className="mono">{r.worktree}</td>
                    <td>{r.session}</td>
                    <td>{r.pr}</td>
                    <td>
                      <span className={"disk-state tone-" + r.tone}>{r.status}</span>
                    </td>
                    <td className="mono">{r.size}</td>
                    <td className="mono">{r.ports}</td>
                    <td className="muted">{r.plan}</td>
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
            <table className="disk-table">
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
                    <td className="mono">{p.command}</td>
                    <td className="mono">{p.worktree}</td>
                    <td>{p.session}</td>
                    <td>
                      <button type="button" className="disk-kill disk-danger" onClick={() => void onAction(killAction(p), p)}>
                        Kill…
                      </button>
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
            <table className="disk-table">
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
                    <td className="mono">{r.worktree}</td>
                    <td className="mono">{r.branch}</td>
                    <td>{r.when}</td>
                    <td>{r.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : null}
      </section>
      {pending ? <Confirm pending={pending} busy={busy} error={actionError} onCancel={() => setPending(null)} onConfirm={() => void confirm()} /> : null}
    </div>
  );
}
