import { useEffect, useState, type FormEvent } from "react";
import { endSession, killDevServers, muteSession, renameSession, resumeSession, sessionOptions, switchSession, type Authed, type SwitchKind } from "../api";
import type { KeyValue } from "../auth";
import { commandItems, confirmEnd, killedNote, type Command } from "../commands";
import type { Session } from "../stream";
import { sessionTitle } from "./SessionList";

export type MenuPoint = { x: number; y: number; n: number };

type Dialog = "rename" | "model" | "effort" | "end" | null;

type Note = { text: string; error: boolean } | null;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type SessionCommandsProps = {
  api: Authed;
  session: Session;
  storage: KeyValue;
  button?: boolean;
  openAt?: MenuPoint | null;
};

export function SessionCommands({ api, session, storage, button, openAt }: SessionCommandsProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [note, setNote] = useState<Note>(null);

  useEffect(() => {
    if (openAt) {
      setMenu({ x: openAt.x, y: openAt.y });
    }
  }, [openAt]);

  const run = async (call: () => Promise<string | null>) => {
    setNote(null);
    try {
      const text = await call();
      setNote(text === null ? null : { text, error: false });
      return true;
    } catch (err) {
      setNote({ text: errorText(err), error: true });
      return false;
    }
  };

  const choose = (command: Command) => {
    setMenu(null);
    const id = session.ID;
    switch (command) {
      case "rename":
      case "model":
      case "effort":
        setDialog(command);
        return;
      case "end":
        if (confirmEnd(storage)) {
          setDialog("end");
          return;
        }
        void run(() => endSession(api, id).then(() => null));
        return;
      case "mute":
        void run(() => muteSession(api, id, !session.Muted).then(() => null));
        return;
      case "resume":
        void run(() => resumeSession(api, id).then(() => null));
        return;
      case "kill":
        void run(() => killDevServers(api, id).then((r) => killedNote(r.killed ?? [])));
        return;
    }
  };

  const openFromButton = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom + 4 });
  };

  return (
    <>
      {button ? (
        <button type="button" className="secondary commands-button" aria-haspopup="menu" aria-label="Session commands" aria-expanded={menu !== null} onClick={(e) => openFromButton(e.currentTarget)}>
          ⋯
        </button>
      ) : null}
      {menu ? <Menu session={session} at={menu} onChoose={choose} onClose={() => setMenu(null)} /> : null}
      {dialog === "rename" ? (
        <RenameDialog
          session={session}
          onClose={() => setDialog(null)}
          onRename={async (name) => {
            if (await run(() => renameSession(api, session.ID, name).then(() => null))) {
              setDialog(null);
            }
          }}
        />
      ) : null}
      {dialog === "model" || dialog === "effort" ? (
        <ChoiceDialog
          api={api}
          session={session}
          kind={dialog}
          onClose={() => setDialog(null)}
          onChoose={async (value) => {
            const kind = dialog;
            if (await run(() => switchSession(api, session.ID, kind, value).then(() => null))) {
              setDialog(null);
            }
          }}
        />
      ) : null}
      {dialog === "end" ? (
        <EndDialog
          session={session}
          onClose={() => setDialog(null)}
          onEnd={async () => {
            if (await run(() => endSession(api, session.ID).then(() => null))) {
              setDialog(null);
            }
          }}
        />
      ) : null}
      {note ? (
        <div className={"command-note" + (note.error ? " error" : "")} role={note.error ? "alert" : "status"}>
          <span>{note.text}</span>
          <button type="button" className="secondary" onClick={() => setNote(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
    </>
  );
}

function Menu({ session, at, onChoose, onClose }: { session: Session; at: { x: number; y: number }; onChoose: (c: Command) => void; onClose: () => void }) {
  const items = commandItems(session);
  return (
    <div className="menu-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div
        className="command-menu"
        role="menu"
        aria-label="Session commands"
        style={{ left: Math.max(8, Math.min(at.x, window.innerWidth - 240)), top: Math.max(8, Math.min(at.y, window.innerHeight - 340)) }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onClose();
          }
        }}
      >
        <p className="menu-title">{sessionTitle(session)}</p>
        {items.map((item, i) => (
          <button key={item.id} type="button" role="menuitem" autoFocus={i === 0} className={item.id === "end" ? "menu-danger" : undefined} onClick={() => onChoose(item.id)}>
            {item.title}
          </button>
        ))}
      </div>
    </div>
  );
}

function RenameDialog({ session, onClose, onRename }: { session: Session; onClose: () => void; onRename: (name: string) => Promise<void> }) {
  const [name, setName] = useState(sessionTitle(session));
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await onRename(name.trim());
    setBusy(false);
  };
  return (
    <div className="dialog-backdrop">
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="rename-title" onSubmit={(e) => void submit(e)}>
        <h2 id="rename-title">Rename session</h2>
        <p className="muted">The name stays when the PR or the task changes.</p>
        <label className="field">
          <span>Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy || name.trim() === ""}>
            Rename
          </button>
        </div>
      </form>
    </div>
  );
}

function ChoiceDialog({ api, session, kind, onClose, onChoose }: { api: Authed; session: Session; kind: SwitchKind; onClose: () => void; onChoose: (value: string) => Promise<void> }) {
  const [choices, setChoices] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    sessionOptions(api.fetch, api.token)
      .then((o) => {
        const h = o.harnesses.find((x) => x.harness === session.Harness);
        if (live) {
          setChoices((kind === "model" ? h?.models : h?.efforts) ?? []);
        }
      })
      .catch((err) => {
        if (live) {
          setError(errorText(err));
        }
      });
    return () => {
      live = false;
    };
  }, [api, session.Harness, kind]);
  const current = kind === "model" ? session.Model : session.Effort;
  const title = kind === "model" ? "Switch model" : "Switch effort";
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="choice-title">
        <h2 id="choice-title">{title}</h2>
        <p className="muted">The agent gets the change before its next turn.</p>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {choices === null && !error ? <p className="muted">Loading…</p> : null}
        {choices !== null && choices.length === 0 ? <p className="muted">This agent has no {kind} choices.</p> : null}
        {choices && choices.length > 0 ? (
          <div className="choice-list">
            {choices.map((c) => (
              <button
                key={c}
                type="button"
                className={c === current ? "" : "secondary"}
                aria-pressed={c === current}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await onChoose(c);
                  setBusy(false);
                }}
              >
                {c}
              </button>
            ))}
          </div>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function EndDialog({ session, onClose, onEnd }: { session: Session; onClose: () => void; onEnd: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="end-title" aria-describedby="end-body">
        <h2 id="end-title">End this session?</h2>
        <p id="end-body">
          {sessionTitle(session)} stops. Its worktrees and branches stay. You can resume it later from the Ended group.
        </p>
        <div className="dialog-actions">
          <button type="button" className="secondary" autoFocus onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onEnd();
              setBusy(false);
            }}
          >
            End session
          </button>
        </div>
      </div>
    </div>
  );
}
