import { useEffect, useRef, useSyncExternalStore } from "react";
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

export function TerminalPane({ store, session, kind, onBack }: { store: TerminalStore | null; session: Session; kind: PaneKind; onBack?: () => void }) {
  if (!store) {
    return (
      <div className="pane-placeholder">
        <p className="pane-title">{titles[kind]}</p>
        <p className="muted">This app cannot show a terminal.</p>
      </div>
    );
  }
  return <Attached key={session.ID + kind} store={store} session={session} kind={kind} onBack={onBack} />;
}

function Attached({ store, session, kind, onBack }: { store: TerminalStore; session: Session; kind: PaneKind; onBack?: () => void }) {
  const entry = store.entry(session, kind);
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
          <div className="term-state-actions">
            <button type="button" className="ui btn" onClick={onBack}>
              Back to chat
            </button>
            <button type="button" className="ui btn primary" onClick={() => entry.retry()}>
              Open again
            </button>
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
