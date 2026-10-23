import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Session } from "../stream";
import type { PaneKind, TermStatus, TerminalStore } from "../terminal";

const titles: Record<PaneKind, string> = { agent: "Terminal", shell: "Shell", nvim: "nvim" };

function notice(status: TermStatus): { text: string; action: string | null } | null {
  switch (status.kind) {
    case "idle":
    case "live":
      return null;
    case "opening":
    case "connecting":
      return { text: "Connecting…", action: null };
    case "gone":
      return { text: "The pane is gone.", action: "Open again" };
    case "paneClosed":
      return { text: "This session's pane closed.", action: "Open again" };
    case "unavailable":
      return { text: "tmux is not available on the server.", action: "Try again" };
    case "closed":
      return { text: "The terminal is disconnected.", action: "Reconnect" };
    case "failed":
      return { text: status.message, action: "Try again" };
  }
}

type PaneProps = { store: TerminalStore | null; session: Session; kind: PaneKind; onBack?: () => void; onResume?: () => Promise<void> };

export function TerminalPane({ store, session, kind, onBack, onResume }: PaneProps) {
  if (!store) {
    return (
      <div className="pane-placeholder">
        <p className="pane-title">{titles[kind]}</p>
        <p className="muted">This app cannot show a terminal.</p>
      </div>
    );
  }
  return <Attached key={session.ID + kind} store={store} session={session} kind={kind} onBack={onBack} onResume={onResume} />;
}

function Attached({ store, session, kind, onBack, onResume }: PaneProps & { store: TerminalStore }) {
  const entry = store.entry(session, kind);
  const [resuming, setResuming] = useState(false);
  const [problem, setProblem] = useState("");
  const resume = async () => {
    if (!onResume) {
      return;
    }
    setResuming(true);
    setProblem("");
    try {
      await onResume();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    } finally {
      setResuming(false);
    }
  };
  const status = useSyncExternalStore(entry.subscribe, entry.snapshot);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) {
      return;
    }
    el.appendChild(entry.host);
    entry.term.fit();
    entry.start();
    entry.term.focus();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => entry.term.fit());
      observer.observe(el);
    }
    return () => {
      observer?.disconnect();
      if (entry.host.parentElement === el) {
        el.removeChild(entry.host);
      }
    };
  }, [entry]);

  const shown = notice(status);
  if (status.kind === "paneClosed" && onBack) {
    return (
      <div className="term-pane">
        <div className="term-box" ref={box} />
        <div className="term-state" role="status">
          <p className="t">{"This session's pane closed"}</p>
          <p className="s">The agent is not running in tmux anymore. Its chat and changes are still here.</p>
          {!session.Ended && onResume ? <p className="s">Resume session shows here when crew ends the session.</p> : null}
          {problem ? (
            <p className="s" role="alert">
              {problem}
            </p>
          ) : null}
          <div className="term-state-actions">
            <button type="button" className="ui btn" onClick={onBack}>
              Back to chat
            </button>
            {session.Ended && onResume ? (
              <button type="button" className="ui btn primary" disabled={resuming} onClick={() => void resume()}>
                Resume session
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="term-pane">
      <div className="term-box" ref={box} />
      {shown ? (
        <div className="term-notice" role="status">
          <span>{shown.text}</span>
          {shown.action ? (
            <button type="button" className="term-retry" onClick={() => entry.retry()}>
              {shown.action}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
