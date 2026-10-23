import { useEffect, useState } from "react";
import { type Approval, type Authed, ApiError, decideApproval, listApprovals } from "../api";
import type { PageVisibility } from "../App";
import { Button } from "../ui";
import { MateFace } from "./Mates";

const ttlMs = 24 * 60 * 60 * 1000;

function words(kind: string): string {
  return kind.replaceAll("_", " ");
}

function expiresIn(at: string, now: number): string {
  const end = Date.parse(at) + ttlMs;
  if (Number.isNaN(end)) {
    return "";
  }
  const minutes = Math.max(0, Math.floor((end - now) / 60000));
  const hours = Math.floor(minutes / 60);
  return "expires in " + (hours > 0 ? hours + "h" : minutes + "m");
}

function ago(at: string, now: number): string {
  const start = Date.parse(at);
  if (Number.isNaN(start)) {
    return "";
  }
  const minutes = Math.max(0, Math.floor((now - start) / 60000));
  if (minutes < 60) {
    return minutes + "m ago";
  }
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? hours + "h ago" : Math.floor(hours / 24) + "d ago";
}

function Card({ api, approval, now }: { api: Authed; approval: Approval; now: number }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [failed, setFailed] = useState("");

  async function decide(approve: boolean) {
    setBusy(true);
    setFailed("");
    try {
      await decideApproval(api, approval.ID, approve);
      setDone(approve ? "Approved. The session tries it again." : "Denied. The session is told no.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof ApiError && (err.code === "stale" || err.code === "not_found")) {
        setDone("This approval is gone: " + message);
      } else {
        setFailed(message);
      }
    } finally {
      setBusy(false);
    }
  }

  const mate = approval.Mate || "crew";
  const session = "#/sessions/" + encodeURIComponent(approval.SessionID);
  return (
    <li className={"ap-card" + (done ? " resolved" : "")} aria-label={mate + ": " + words(approval.Action.Kind)}>
      <MateFace name={mate} state={done ? "idle" : "needs"} px={28} />
      <div className="ap-body">
        {done ? (
          <div>
            <b>{mate}</b>{" "}
            <span className="ap-muted" role="status">
              · {done}
            </span>
          </div>
        ) : (
          <>
            <div>
              <b>{mate}</b>{" "}
              <span className="ap-muted">
                wants to {words(approval.Action.Kind)}, asked by {approval.Requester || "someone"} with {approval.Action.Tool} · {ago(approval.At, now)} · {expiresIn(approval.At, now)} ·{" "}
                <a className="open-session" href={session}>
                  Open session
                </a>
              </span>
            </div>
            <pre className="ap-input">{approval.Action.Input}</pre>
            {failed && <p role="alert">{failed}</p>}
          </>
        )}
      </div>
      {done ? (
        <a className="ui btn quiet ap-small open-session" href={session}>
          Open session
        </a>
      ) : (
        <div className="approval-actions">
          <Button disabled={busy} onClick={() => decide(false)}>
            Deny
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => decide(true)}>
            Approve
          </Button>
        </div>
      )}
    </li>
  );
}

function useApprovals(api: Authed, now: number, visibility?: PageVisibility) {
  const [list, setList] = useState<Approval[] | null>(null);
  const [error, setError] = useState("");
  const [shown, setShown] = useState(0);

  useEffect(
    () =>
      visibility?.onChange(() => {
        if (visibility.visible()) {
          setShown((n) => n + 1);
        }
      }),
    [visibility],
  );

  useEffect(() => {
    let live = true;
    listApprovals(api)
      .then((out) => {
        if (live) {
          setList(out);
          setError("");
        }
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [api, now, shown]);
  return { list, error };
}

export function Approvals({ api, now, visibility }: { api: Authed; now: number; visibility?: PageVisibility }) {
  const { list, error } = useApprovals(api, now, visibility);
  const count = list?.length ?? 0;
  return (
    <main className="screen ap-page">
      <div className="ap-head">
        <h1>Approvals</h1>
        {count > 0 && (
          <span className="ap-pill" aria-label={count + " waiting"}>
            {count}
          </span>
        )}
      </div>
      <p className="ap-explain">A mate asks here before a dangerous action that someone other than you started.</p>
      {error && <p role="alert">{error}</p>}
      {list === null && !error && <p>Loading…</p>}
      {list !== null && list.length === 0 && <p>No approvals wait for you.</p>}
      <ul className="ap-list">
        {(list ?? []).map((a) => (
          <Card key={a.ID} api={api} approval={a} now={now} />
        ))}
      </ul>
    </main>
  );
}
