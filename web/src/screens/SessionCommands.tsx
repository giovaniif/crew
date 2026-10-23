import { useEffect, useState, type FormEvent } from "react";
import { endSession, interrupt, killDevServers, muteSession, renameSession, resumeSession, sessionOptions, switchSession, type Authed, type SwitchKind } from "../api";
import type { KeyValue } from "../auth";
import { commandItems, confirmEnd, killedNote, type Command } from "../commands";
import { openSessionView } from "../route";
import type { Session } from "../stream";
import { Button, Dialog, Menu, Toast, type MenuEntry } from "../ui";
import { sessionTitle } from "./SessionList";

export type MenuPoint = { x: number; y: number; n: number };

type Open = "rename" | "model" | "effort" | "end" | "interrupt" | null;

type Note = { text: string; error: boolean; undo?: () => void } | null;

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
  const [dialog, setDialog] = useState<Open>(null);
  const [note, setNote] = useState<Note>(null);

  useEffect(() => {
    if (openAt) {
      setMenu({ x: openAt.x, y: openAt.y });
    }
  }, [openAt]);

  const run = async (call: () => Promise<string | null>, undo?: () => void) => {
    setNote(null);
    try {
      const text = await call();
      setNote(text === null ? null : { text, error: false, undo });
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
      case "interrupt":
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
      case "agent":
        openSessionView(id, "agent");
        return;
      case "editor":
        openSessionView(id, "editor");
        return;
      case "browser":
        openSessionView(id, "browser");
        return;
    }
  };

  const openFromButton = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setMenu({ x: r.right - 240, y: r.bottom + 4 });
  };

  const rename = (name: string, undo: boolean) => {
    const before = sessionTitle(session);
    return run(
      () => renameSession(api, session.ID, name).then(() => (undo ? "Renamed to “" + name + "”" : null)),
      undo ? () => void rename(before, false) : undefined,
    );
  };

  return (
    <>
      {button ? (
        <Button variant="icon" className="commands-button" aria-haspopup="menu" aria-label="Session commands" aria-expanded={menu !== null} onClick={(e) => openFromButton(e.currentTarget)}>
          ⋯
        </Button>
      ) : null}
      {menu ? <CommandMenu session={session} at={menu} onChoose={choose} onClose={() => setMenu(null)} /> : null}
      {dialog === "rename" ? (
        <RenameDialog
          session={session}
          onClose={() => setDialog(null)}
          onRename={async (name) => {
            if (await rename(name, true)) {
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
        <ConfirmDialog
          title="End this session?"
          body="The agent stops. The worktree and branch stay; you can resume it later from the Ended group."
          action="End session"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            if (await run(() => endSession(api, session.ID).then(() => null))) {
              setDialog(null);
            }
          }}
        />
      ) : null}
      {dialog === "interrupt" ? (
        <ConfirmDialog
          title="Interrupt this session?"
          body="The agent stops what it is doing, as if you pressed Escape in its terminal."
          action="Interrupt"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            if (await run(() => interrupt(api, session.ID).then(() => null))) {
              setDialog(null);
            }
          }}
        />
      ) : null}
      {note ? (
        <div className="command-note">
          {note.error ? (
            <div className="ui toast error" role="alert">
              <span>{note.text}</span>
              <Button onClick={() => setNote(null)}>Dismiss</Button>
            </div>
          ) : note.undo ? (
            <Toast
              message={note.text}
              action="Undo"
              onAction={() => {
                const undo = note.undo;
                setNote(null);
                undo?.();
              }}
            />
          ) : (
            <Toast message={note.text} action="Dismiss" onAction={() => setNote(null)} />
          )}
        </div>
      ) : null}
    </>
  );
}

function CommandMenu({ session, at, onChoose, onClose }: { session: Session; at: { x: number; y: number }; onChoose: (c: Command) => void; onClose: () => void }) {
  const items: MenuEntry[] = commandItems(session).map((e) => (e === "sep" ? { kind: "sep" } : { value: e.id, label: e.title, hint: e.hint }));
  return (
    <div
      className="menu-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="session-menu-at" style={{ left: Math.max(8, Math.min(at.x, window.innerWidth - 248)), top: Math.max(8, Math.min(at.y, window.innerHeight - 380)) }}>
        <Menu label="Session commands" className={"session-menu" + (session.Ended ? " ended" : "")} items={items} onPick={(v) => onChoose(v as Command)} onClose={onClose} />
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
    <Dialog title="Rename session" onClose={onClose}>
      <form className="command-dialog" onSubmit={(e) => void submit(e)}>
        <p>The name stays when the PR or the task changes.</p>
        <input className="ui input" aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="actions">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy || name.trim() === ""}>
            Rename
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ChoiceDialog({ api, session, kind, onClose, onChoose }: { api: Authed; session: Session; kind: SwitchKind; onClose: () => void; onChoose: (value: string) => Promise<void> }) {
  const current = kind === "model" ? session.Model : session.Effort;
  const [choices, setChoices] = useState<string[] | null>(null);
  const [picked, setPicked] = useState(current);
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
  return (
    <Dialog title={kind === "model" ? "Switch model" : "Switch effort"} onClose={onClose}>
      <div className="command-dialog">
        <p>The agent gets the change before its next turn.</p>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {choices === null && !error ? <p>Loading…</p> : null}
        {choices !== null && choices.length === 0 ? <p>This agent has no {kind} choices.</p> : null}
        {choices && choices.length > 0 ? (
          <div className="choice-list" role="listbox" aria-label={kind === "model" ? "Model" : "Effort"}>
            {choices.map((c) => (
              <div key={c} role="option" aria-selected={c === picked} tabIndex={0} className={"item" + (c === picked ? " hi" : "")} onClick={() => setPicked(c)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setPicked(c)}>
                <span className="ck" aria-hidden="true">
                  {c === picked ? "✓" : ""}
                </span>
                <span>{c}</span>
                {c === current ? <span className="k">current</span> : null}
              </div>
            ))}
          </div>
        ) : null}
        <div className="actions">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || !picked || picked === current}
            onClick={async () => {
              setBusy(true);
              await onChoose(picked);
              setBusy(false);
            }}
          >
            Switch
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function ConfirmDialog({ title, body, action, onClose, onConfirm }: { title: string; body: string; action: string; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="command-dialog">
        <p>{body}</p>
        <div className="actions">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onConfirm();
              setBusy(false);
            }}
          >
            {action}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
