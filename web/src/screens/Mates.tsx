import { type FormEvent, type KeyboardEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { CopyMate } from "./CopyMate";
import { defaultPick, EnvChip, EnvRail, type EnvPick } from "./EnvPicker";
import { authedOf, useHub } from "../hub";
import type { DesktopBridge } from "../desktopBridge";
import { Servers } from "../servers";
import { isYours } from "../envmenu";
import type { MateEnvironment } from "../api";
import { InterruptButton, StartFreshButton, ThreadChat } from "./Session";
import {
  type Authed,
  type HarnessOptions,
  type Mate,
  type MateClaim,
  type MateMemory,
  type MateSetup,
  claimMate,
  listApprovals,
  listAutomations,
  listMates,
  mateMemory,
  mateSetup,
  newMateConversation,
  sendMessage,
  pauseMate,
  resetMate,
  saveMate,
  sessionOptions,
  setMateMemory,
  setMateTokens,
  stopAllMates,
} from "../api";
import { ACCENTS, FACES, type FaceState, faceColor, faceOf, faceState, faceSvg, mateCard, type ToneAxis, toneOf } from "../faces";
import { type MateAutomation, answersIn, harnessLabel, mateAutomations, mateHistory, mateLine, mateRoute, mateSlug, nameCheck, replyHint, roleLine, shownConversation, toneSteps } from "../matepage";
import type { Mates as MateBoard, StreamClient, StreamSnapshot } from "../stream";
import { Button, Dialog, Menu, Segmented, Select, Slider } from "../ui";

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function prefersDark(): boolean {
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  } catch {
    return false;
  }
}

export function MateFace({ name, avatar, color, state, px }: { name: string; avatar?: string; color?: string; state: FaceState; px: number }) {
  const face = faceOf(name, avatar);
  return <span className="face" dangerouslySetInnerHTML={{ __html: faceSvg(face, state, faceColor(face, color, prefersDark()), px) }} />;
}

export function SlackMark({ px }: { px: number }) {
  return (
    <svg width={px} height={px} viewBox="0 0 122.8 122.8" role="img" aria-label="Slack">
      <path
        d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z"
        fill="#e01e5a"
      />
      <path
        d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z"
        fill="#36c5f0"
      />
      <path
        d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z"
        fill="#2eb67d"
      />
      <path
        d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z"
        fill="#ecb22e"
      />
    </svg>
  );
}

export function useMateDefs(api: Authed): { defs: Mate[]; tones: ToneAxis[]; problems: string[]; error: string; reload: () => void } {
  const [defs, setDefs] = useState<Mate[]>([]);
  const [tones, setTones] = useState<ToneAxis[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState("");
  const seq = useRef(0);
  const reload = useCallback(() => {
    const mine = ++seq.current;
    listMates(api)
      .then((out) => {
        if (seq.current !== mine) {
          return;
        }
        setDefs(out.mates ?? []);
        setTones(out.tones ?? []);
        setProblems(out.problems ?? []);
        setError("");
      })
      .catch((err) => seq.current === mine && setError(message(err)));
  }, [api]);
  useEffect(() => {
    reload();
    return () => {
      seq.current++;
    };
  }, [reload]);
  return { defs, tones, problems, error, reload };
}

function useAskingMates(api: Authed): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    listApprovals(api)
      .then((list) => live && setNames(list.filter((a) => a.State === "pending").map((a) => a.Mate)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api]);
  return names;
}

function Connect({ api, name }: { api: Authed; name: string }) {
  const [setup, setSetup] = useState<MateSetup | null>(null);
  const [bot, setBot] = useState("");
  const [app, setApp] = useState("");
  const [claim, setClaim] = useState<MateClaim | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    let live = true;
    mateSetup(api, name)
      .then((out) => live && setSetup(out))
      .catch((err) => live && setNote(message(err)));
    return () => {
      live = false;
    };
  }, [api, name]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote("");
    try {
      await setMateTokens(api, name, bot.trim(), app.trim());
      setBot("");
      setApp("");
      setClaim(await claimMate(api, name));
    } catch (err) {
      setNote(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-panel mt-connect" aria-label={"Connect " + name}>
      <ol>
        <li>
          {setup ? (
            <a href={setup.url} target="_blank" rel="noreferrer">
              Make the Slack app from the manifest
            </a>
          ) : (
            "Make the Slack app from the manifest"
          )}
        </li>
        <li>Install the app in your workspace. A workspace admin may need to approve it first.</li>
        <li>Copy the bot token (xoxb-) from OAuth &amp; Permissions.</li>
        <li>Make an app-level token (xapp-) with the scope connections:write in Basic Information, and copy it.</li>
      </ol>
      {claim ? (
        <p role="status">
          To become the owner of {name}, send this code to @{name} in a direct message in Slack in the next 10 minutes: <code>{claim.code}</code>
        </p>
      ) : (
        <form className="mt-form" onSubmit={submit}>
          <div className="mt-two">
            <label className="mt-field">
              Bot token
              <input className="ui input" type="password" autoComplete="off" value={bot} onChange={(e) => setBot(e.target.value)} />
            </label>
            <label className="mt-field">
              App token
              <input className="ui input" type="password" autoComplete="off" value={app} onChange={(e) => setApp(e.target.value)} />
            </label>
          </div>
          <div className="mt-actions">
            <Button type="submit" variant="primary" disabled={busy || bot.trim() === "" || app.trim() === ""}>
              Save tokens
            </Button>
          </div>
        </form>
      )}
      {note && <p role="alert">{note}</p>}
    </section>
  );
}

export function Confirm({
  id,
  title,
  body,
  action,
  danger,
  busy,
  note,
  onCancel,
  onConfirm,
  children,
}: {
  id: string;
  title: string;
  body: string;
  action: string;
  danger?: boolean;
  busy?: boolean;
  note?: string;
  onCancel: () => void;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={id + "-title"} aria-describedby={id + "-body"}>
        <h2 id={id + "-title"}>{title}</h2>
        <p id={id + "-body"}>{body}</p>
        {children}
        {note ? (
          <p className="error" role="alert">
            {note}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="secondary" autoFocus onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={danger ? "danger" : "primary"} disabled={busy} onClick={onConfirm}>
            {action}
          </button>
        </div>
      </div>
    </div>
  );
}

function useMemory(api: Authed, name: string) {
  const [memory, setMemory] = useState<MateMemory | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    let live = true;
    mateMemory(api, name)
      .then((out) => live && setMemory(out))
      .catch((err) => live && setNote(message(err)));
    return () => {
      live = false;
    };
  }, [api, name]);
  return { memory, setMemory, note, setNote };
}

function Memory({ name, mem, save }: { name: string; mem: ReturnType<typeof useMemory>; save: (text: string) => Promise<boolean> }) {
  const { memory, note } = mem;
  const [draft, setDraft] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const limit = memory?.limit ?? 8192;
  return (
    <section aria-label={"Memory section of " + name}>
      <div className="mt-section">
        <h2>Memory</h2>
        <span className="spacer" />
        {draft === null && (
          <>
            <Button variant="quiet" className="mt-tiny" onClick={() => setDraft(memory?.text ?? "")}>
              Edit
            </Button>
            <Button variant="quiet" className="mt-tiny danger" disabled={!memory?.text} onClick={() => setClearing(true)}>
              Clear…
            </Button>
          </>
        )}
      </div>
      {draft === null ? (
        <pre className="mt-mem">{memory?.text ? memory.text : "Empty. " + name + " writes notes here as it learns."}</pre>
      ) : (
        <>
          <textarea className="ui input mt-area" aria-label={"Memory of " + name} rows={8} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <p className="mt-sub">
            {new TextEncoder().encode(draft).length} of {limit} bytes. Empty text clears the memory.
          </p>
          <div className="mt-actions">
            <Button variant="quiet" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void save(draft).then((ok) => ok && setDraft(null))}>
              Save memory
            </Button>
          </div>
        </>
      )}
      {note && !clearing && <p role="alert">{note}</p>}
      {clearing && (
        <Dialog title={"Clear the memory of " + name + "?"} onClose={() => setClearing(false)}>
          <p>{name} forgets all its notes. Its personality stays.</p>
          {note && (
            <p className="error" role="alert">
              {note}
            </p>
          )}
          <div className="dialog-actions">
            <Button onClick={() => setClearing(false)}>Cancel</Button>
            <Button variant="primary" className="mt-danger-fill" onClick={() => void save("").then((ok) => ok && setClearing(false))}>
              Clear
            </Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}


export function useHarnessOptions(api: Authed): HarnessOptions[] {
  const [list, setList] = useState<HarnessOptions[]>([]);
  useEffect(() => {
    let live = true;
    sessionOptions(api.fetch, api.token)
      .then((out) => live && setList(out.harnesses ?? []))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api]);
  return list;
}

const harnesses = [
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
  { value: "omp", label: "Pi" },
];

function choices(values: string[] | undefined, current: string | undefined): { value: string; label: string }[] {
  const list = [...(values ?? [])];
  if (current && !list.includes(current)) {
    list.unshift(current);
  }
  return [{ value: "", label: "default" }, ...list.map((v) => ({ value: v, label: v }))];
}

function sizeLabel(text: string): string {
  const bytes = new TextEncoder().encode(text).length;
  return bytes < 1024 ? bytes + " bytes" : (bytes / 1024).toFixed(1) + " KB";
}

function StopAll({ api, stopped, onClose }: { api: Authed; stopped: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  async function flip() {
    setBusy(true);
    setNote("");
    try {
      await stopAllMates(api, !stopped);
      onClose();
    } catch (err) {
      setNote(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={stopped ? "Start all mates?" : "Stop all mates?"} onClose={onClose}>
      <p>{stopped ? "The mates can start new turns again." : "They start no new turns until you start them again."}</p>
      {note && (
        <p className="error" role="alert">
          {note}
        </p>
      )}
      <div className="dialog-actions">
        <Button disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" className={stopped ? undefined : "mt-danger-fill"} disabled={busy} onClick={() => void flip()}>
          {stopped ? "Start all" : "Stop all"}
        </Button>
      </div>
    </Dialog>
  );
}

function StartFresh({ api, name, onClose }: { api: Authed; name: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  async function reset() {
    setBusy(true);
    setNote("");
    try {
      await resetMate(api, name);
      window.location.hash = "#/mates/" + encodeURIComponent(name);
      onClose();
    } catch (err) {
      setNote(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Start fresh?" onClose={onClose}>
      <p>{"This clears the context of " + name + ". The current conversation stops and stays as history. You can read it, but it does not continue. The next message starts a new conversation."}</p>
      {note && (
        <p className="error" role="alert">
          {note}
        </p>
      )}
      <div className="dialog-actions">
        <Button disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={busy} onClick={() => void reset()}>
          Start fresh
        </Button>
      </div>
    </Dialog>
  );
}

function MoreMenu({ api, name, stopped, history }: { api: Authed; name: string; stopped: boolean; history: { session: string; title: string }[] }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState("");
  const items = [
    { value: "fresh", label: "Start fresh…" },
    { value: "copy", label: "Copy to another machine…" },
    ...history.map((h) => ({ value: "h:" + h.session, label: "History: " + h.title })),
    { value: "stop", label: stopped ? "Start all mates…" : "Stop all mates…" },
  ];
  return (
    <span className="ui-anchor">
      <button type="button" className="ui btn quiet mp-more" aria-label={"More for " + name} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        ⋯
      </button>
      {open && (
        <Menu
          label={"More for " + name}
          className="mp-more-menu"
          items={items}
          onPick={(v: string) => {
            setOpen(false);
            if (v.startsWith("h:")) {
              window.location.hash = "#/mates/" + encodeURIComponent(name) + "/" + encodeURIComponent(v.slice(2));
              return;
            }
            setAsking(v);
          }}
          onClose={() => setOpen(false)}
        />
      )}
      {asking === "stop" && <StopAll api={api} stopped={stopped} onClose={() => setAsking("")} />}
      {asking === "fresh" && <StartFresh api={api} name={name} onClose={() => setAsking("")} />}
      {asking === "copy" && <CopyMate api={api} name={name} onClose={() => setAsking("")} />}
    </span>
  );
}

function useMateAutomations(api: Authed, name: string): MateAutomation[] {
  const [list, setList] = useState<MateAutomation[]>([]);
  useEffect(() => {
    let live = true;
    listAutomations(api)
      .then((out) => live && setList(mateAutomations(out.automations ?? [], name)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api, name]);
  return list;
}

export function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function FirstThread({ api, name, agent }: { api: Authed; name: string; agent: string }) {
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const blank = draft.trim() === "";

  async function submit(ev: FormEvent | KeyboardEvent<HTMLTextAreaElement>) {
    ev.preventDefault();
    if (blank || posting) {
      return;
    }
    setPosting(true);
    setError("");
    try {
      const s = await newMateConversation(api, name);
      await sendMessage(api, s.ID, draft);
      window.location.hash = "#/mates/" + encodeURIComponent(name) + "/" + encodeURIComponent(s.ID);
    } catch (err) {
      setError(message(err));
      setPosting(false);
    }
  }

  function onKey(ev: KeyboardEvent<HTMLTextAreaElement>) {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.nativeEvent.isComposing) {
      void submit(ev);
    }
  }

  return (
    <div className="chat-screen mp-chat mp-first">
      <div className="mp-first-log" />
      <footer className="composer">
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <form className="composer-box" onSubmit={(ev) => void submit(ev)}>
          <textarea aria-label="Message" rows={1} autoFocus value={draft} placeholder={replyHint(name)} onChange={(ev) => setDraft(ev.target.value)} onKeyDown={onKey} />
          <div className="composer-foot" role="group" aria-label="Composer options">
            {agent ? <span className="composer-chip">{agent}</span> : null}
            <span className="spacer" />
            <button type="submit" className="send" aria-label="Send" disabled={blank || posting}>
              ↑
            </button>
          </div>
        </form>
      </footer>
    </div>
  );
}

function FaceGrid({ avatar, color, onPick }: { avatar: string; color?: string; onPick: (patch: { avatar?: string; color?: string }) => void }) {
  const chosen = faceOf(avatar, avatar);
  const shown = faceColor(chosen, color, false);
  return (
    <>
      <div className="mt-faces mp-faces">
        {FACES.map((f) => (
          <button key={f.id} type="button" aria-label={f.name} aria-pressed={f.id === chosen.id} className={f.id === chosen.id ? "on" : ""} onClick={() => onPick({ avatar: f.id })}>
            <MateFace name={f.id} state="idle" color={f.id === chosen.id ? color : undefined} px={28} />
          </button>
        ))}
      </div>
      <div className="swatches mp-swatches">
        {ACCENTS.map((c) => (
          <button key={c} type="button" className={"swatch" + (c === shown ? " on" : "")} aria-label={"Color " + c} style={{ backgroundColor: c }} onClick={() => onPick({ color: c })} />
        ))}
      </div>
    </>
  );
}

export function FaceButton({ name, avatar, color, onPick }: { name: string; avatar?: string; color?: string; onPick: (patch: { avatar?: string; color?: string }) => void }) {
  const [open, setOpen] = useState(false);
  const face = faceOf(name, avatar);
  return (
    <>
      <button type="button" className="face-pick" aria-label="Change face" onClick={() => setOpen(true)}>
        <MateFace name={name} avatar={avatar} color={color} state="idle" px={28} />
      </button>
      {open && (
        <Dialog title="Face and color" className="face-picker" onClose={() => setOpen(false)}>
          <FaceGrid avatar={face.id} color={color} onPick={onPick} />
          <div className="actions">
            <Button variant="primary" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function MateLook({ name, mate, save }: { name: string; mate: Mate; save: (patch: Partial<Mate>) => void }) {
  return (
    <div className="kv mp-look">
      <h4>LOOK</h4>
      <FaceGrid avatar={faceOf(name, mate.avatar).id} color={mate.color} onPick={save} />
    </div>
  );
}

function MateTone({ tones, mate, save }: { tones: ToneAxis[]; mate: Mate; save: (patch: Partial<Mate>) => void }) {
  if (tones.length === 0) {
    return null;
  }
  const steps = toneSteps(tones, mate.tone);
  return (
    <div className="kv">
      <h4>TONE</h4>
      {tones.map((t, i) => (
        <Slider
          key={t.key}
          label={t.low + " to " + t.high}
          low={t.low}
          high={t.high}
          min={0}
          max={4}
          value={steps[i]}
          valueText={(v) => v + 1 + " of 5"}
          onChange={(v) => save({ tone: toneOf(tones, steps.map((x, j) => (j === i ? v : x))) })}
        />
      ))}
    </div>
  );
}

function MateSettings({
  api,
  def,
  tones,
  channels,
  name,
  connected,
  canConnect,
  connect,
  mem,
  sheet,
  onSaved,
}: {
  api: Authed;
  def: Mate;
  tones: ToneAxis[];
  channels?: string[];
  name: string;
  connected: boolean;
  canConnect: boolean;
  connect: boolean;
  mem: ReturnType<typeof useMemory>;
  sheet: boolean;
  onSaved: () => void;
}) {
  const options = useHarnessOptions(api);
  const [mate, setMate] = useState<Mate>(def);
  const [role, setRole] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(connect);
  const [memOpen, setMemOpen] = useState(false);
  const [copying, setCopying] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => setMate(def), [def]);
  const harness = options.find((h) => h.harness === mate.agent);
  const automations = useMateAutomations(api, name);

  async function save(patch: Partial<Mate>, environment?: MateEnvironment): Promise<boolean> {
    const next = { ...mate, ...patch };
    setMate(next);
    setNote("");
    try {
      await saveMate(api, next, environment);
      onSaved();
      return true;
    } catch (err) {
      setNote(message(err));
      return false;
    }
  }

  async function saveMemory(text: string): Promise<boolean> {
    mem.setNote("");
    try {
      mem.setMemory(await setMateMemory(api, name, text));
      return true;
    } catch (err) {
      mem.setNote(message(err));
      return false;
    }
  }

  return (
    <>
      {copying && <CopyMate api={api} name={name} onClose={() => setCopying(false)} />}
      <EnvRail api={api} mate={mate} extra={[{ value: "+copy", label: "Copy " + name + " to another machine…", run: () => setCopying(true) }]} onPick={(machineId, id) => void save({ env: id }, { machine_id: machineId, identity_id: id })} />
      <div className="kv">
        <h4>HARNESS</h4>
        <Segmented label="Harness" value={mate.agent} options={harnesses} onChange={(agent) => void save({ agent, model: undefined, effort: undefined })} className="mp-seg" />
        <div className="r">
          <span className="k">Model</span>
          <Select label="Model" value={mate.model ?? ""} options={choices(harness?.models, mate.model)} onChange={(v) => void save({ model: v || undefined })} className="mp-select" />
        </div>
        <div className="r">
          <span className="k">Effort</span>
          <Select label="Effort" value={mate.effort ?? ""} options={choices(harness?.efforts, mate.effort)} onChange={(v) => void save({ effort: v || undefined })} className="mp-select" />
        </div>
      </div>
      <div className="kv">
        <h4 className="mp-h">
          ROLE
          <span className="spacer" />
          {role === null && (
            <button type="button" className="mt-link" aria-label="Edit role" onClick={() => setRole(mate.prompt)}>
              Edit
            </button>
          )}
        </h4>
        {role === null ? (
          <div className="mem mp-role">{mate.prompt || "No role yet."}</div>
        ) : (
          <>
            <textarea className="ui input mt-area" aria-label="Role" rows={5} value={role} onChange={(e) => setRole(e.target.value)} />
            <div className="mt-actions">
              <Button variant="quiet" onClick={() => setRole(null)}>
                Cancel
              </Button>
              <Button variant="primary" aria-label="Save role" disabled={role.trim() === ""} onClick={() => void save({ prompt: role.trim() }).then((ok) => ok && setRole(null))}>
                Save
              </Button>
            </div>
          </>
        )}
      </div>
      <div className="kv">
        <h4>SLACK</h4>
        <div className="r">
          <span className="slackm">
            <span className={connected ? "dot ok" : "dot"} aria-hidden="true" />
            {connected ? "Connected as @" + name : "Not connected"}
          </span>
          {canConnect && (
            <button type="button" className="ui btn quiet mp-tiny" onClick={() => setConnecting(!connecting)}>
              Connect…
            </button>
          )}
        </div>
        {connected && (
          <div className="r">
            <span className="k">Answers in</span>
            <span className="dim">{answersIn(channels)}</span>
          </div>
        )}
        {connecting && canConnect && <Connect api={api} name={name} />}
      </div>
      <div className="kv">
        {sheet ? (
          <a className="r mp-row" href="#/automations">
            <span>Automations</span>
            <span className="muted">›</span>
          </a>
        ) : (
          <>
            <h4>AUTOMATIONS</h4>
            {automations.length === 0 ? (
              <span className="muted mp-small">No automation names this mate.</span>
            ) : (
              automations.map((a) => (
                <a key={a.name} className="r mp-row" href="#/automations">
                  <span>{a.name}</span>
                  <span className="muted mp-small">{a.when}</span>
                </a>
              ))
            )}
            <a className="mp-small" href={"#/automations/new?mate=" + encodeURIComponent(name)}>
              + Add automation
            </a>
          </>
        )}
      </div>
      <MateLook name={name} mate={mate} save={(patch) => void save(patch)} />
      <MateTone tones={tones} mate={mate} save={(patch) => void save(patch)} />
      <div className="kv">
        <h4 className="mp-h">
          MEMORY
          <span className="spacer" />
          <span className="muted mp-weight">{mem.memory ? (mem.memory.text ? sizeLabel(mem.memory.text) : "Empty") : ""}</span>
        </h4>
        <button type="button" className="mt-link mp-small" aria-expanded={memOpen} onClick={() => setMemOpen(!memOpen)}>
          View and edit memory
        </button>
        {memOpen && <Memory name={name} mem={mem} save={saveMemory} />}
      </div>
      {note && <p role="alert">{note}</p>}
      <div className="muted mp-note">Changes apply when the next conversation starts.</div>
    </>
  );
}

export function MatePage({
  api,
  hash,
  board,
  snapshot,
  client,
  wide,
}: {
  api: Authed;
  hash: string;
  board?: MateBoard;
  snapshot: StreamSnapshot;
  client: StreamClient;
  wide: boolean;
}) {
  const { name, thread, connect } = mateRoute(hash);
  const { defs, tones, problems, error, reload } = useMateDefs(api);
  const asking = useAskingMates(api);
  const mem = useMemory(api, name);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [sheet, setSheet] = useState(false);
  const row = board?.mates.find((m) => m.name === name);
  const def = defs.find((d) => d.name === name);
  if (!row) {
    return (
      <main className="screen mp">
        {error && <p role="alert">{error}</p>}
        <p className="mt-note">{board === undefined ? "Loading…" : "There is no mate " + name + "."}</p>
      </main>
    );
  }
  const card = mateCard(row, def, asking);
  const state = faceState(row, asking);
  const shown = shownConversation(row, thread);
  const history = mateHistory(row);
  const paused = row.state === "paused";
  const connected = row.state === "connected";
  const canConnect = row.state === "ready" || row.state === "no_tokens";
  const envLabel = isYours(def?.env) ? "Your accounts" : (def?.env as string);
  const face = (px: number) => <MateFace name={name} avatar={row.avatar || def?.avatar} color={row.color || def?.color} state={state} px={px} />;

  async function pause() {
    setBusy(true);
    setNote("");
    try {
      await pauseMate(api, name, !paused);
    } catch (err) {
      setNote(message(err));
    } finally {
      setBusy(false);
    }
  }

  const live = shown.session && !shown.history ? snapshot.state?.sessions.find((s) => s.ID === shown.session) : undefined;
  const working = live && !live.Ended && (live.State === "running" || live.State === "permission");
  async function freshMate(): Promise<string> {
    try {
      await resetMate(api, name);
      return "";
    } catch (err) {
      return message(err);
    }
  }
  const quiet = !live || live.Ended ? null : working ? <InterruptButton key={live.ID} api={api} session={live.ID} /> : <StartFreshButton key={live.ID} onFresh={freshMate} />;

  const settings = (inSheet: boolean) =>
    def ? (
      <MateSettings api={api} def={def} tones={tones} channels={row.channels} name={name} connected={connected} canConnect={canConnect} connect={connect} mem={mem} sheet={inSheet} onSaved={reload} />
    ) : (
      <p className="mt-note">Loading…</p>
    );

  const back = "#/mates/" + encodeURIComponent(name);
  const conversation = shown.session ? (
    <>
      {shown.history && (
        <div className="src mp-src mp-history" role="status">
          <span>History. This conversation does not continue.</span>
          <span className="spacer" />
          <a href={back}>Back to the conversation</a>
        </div>
      )}
      <ThreadChat key={shown.session} id={shown.session} snapshot={snapshot} client={client} api={api} placeholder={replyHint(name)} readOnly={shown.history} />
    </>
  ) : (
    <FirstThread api={api} name={name} agent={harnessLabel(def?.agent ?? "", def?.model)} />
  );

  if (!wide) {
    return (
      <main className="mp mp-phone">
        <header className="mp-ptop">
          <a className="mp-back" href="#/mates" aria-label="Mates">
            ‹
          </a>
          {face(32)}
          <div className="mp-who">
            <h1>{name}</h1>
            <div className="muted mp-line">{mateLine(envLabel, def?.agent ?? "", state)}</div>
          </div>
          {quiet}
          <button type="button" className="ui btn quiet mp-info" aria-label={"Settings of " + name} onClick={() => setSheet(true)}>
            ⓘ
          </button>
          <MoreMenu api={api} name={name} stopped={board?.stopped ?? false} history={history} />
        </header>
        {note && <p role="alert">{note}</p>}
        <section className="mp-conv" aria-label="Conversation">
          {conversation}
        </section>
        {sheet && (
          <div className="mp-scrim" onClick={(e) => e.target === e.currentTarget && setSheet(false)}>
            <div className="mp-sheet ms" role="dialog" aria-modal="true" aria-label={"Settings of " + name}>
              <span className="mp-grab" aria-hidden="true" />
              <div className="mp-sheet-head">
                {face(32)}
                <div className="mp-who">
                  <strong>{name}</strong>
                  <div className="muted mp-line">{card.tagline}</div>
                </div>
                <Button onClick={() => setSheet(false)}>Done</Button>
              </div>
              {settings(true)}
            </div>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="mp">
      <header className="mp-head">
        {face(24)}
        <h1>{name}</h1>
        <span className="muted mp-role-line" title={def?.prompt}>
          {roleLine(def?.prompt ?? "")}
        </span>
        <span className={"pill mp-state " + state}>{state}</span>
        <span className="spacer" />
        {quiet}
        <Button disabled={busy} onClick={() => void pause()}>
          {paused ? "Resume" : "Pause"}
        </Button>
        <MoreMenu api={api} name={name} stopped={board?.stopped ?? false} history={history} />
      </header>
      {note && <p role="alert">{note}</p>}
      {error && <p role="alert">{error}</p>}
      {problems.map((p) => (
        <p key={p} className="mt-error">
          {p}
        </p>
      ))}
      {row.error && <p className="mt-error">{row.error}</p>}
      <div className="mp-split">
        <section className="mp-conv" aria-label="Conversation">
          {conversation}
        </section>
        <aside className="ms mp-rail" aria-label={"Settings of " + name}>
          {settings(false)}
        </aside>
      </div>
    </main>
  );
}

const presets: { label: string; text: string }[] = [
  { label: "Careful reviewer", text: "You are a careful code reviewer. Read the whole diff before you comment. Point at exact lines." },
  { label: "Fast bug fixer", text: "You fix bugs fast. Make the smallest diff that makes the test pass." },
  { label: "Patient explainer", text: "You explain each change as you go, so the owner learns from it." },
  { label: "On-call triage", text: "You triage on-call alerts. Find the cause, tell who owns it, and propose the smallest safe fix." },
];

function ChipMenu({ label, text, items, onPick }: { label: string; text: ReactNode; items: { value: string; label: string; checked?: boolean; hint?: ReactNode }[] | Parameters<typeof Menu>[0]["items"]; onPick: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
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
  return (
    <span ref={anchor} className="ui-anchor">
      <button type="button" className={"chip env-chip" + (open ? " on" : "")} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {text}{" "}
        <span className="chev" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <Menu
          label={label.split(":")[0]}
          items={items}
          onPick={(v) => {
            setOpen(false);
            onPick(v);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}

export function NewMate({ api, repos: known, desktop }: { api: Authed; repos: string[]; desktop?: DesktopBridge }) {
  const { defs } = useMateDefs(api);
  const hub = useHub(api);
  const [pick, setPick] = useState<EnvPick | null>(null);
  const where = pick ?? defaultPick(hub);
  const options = useHarnessOptions(api);
  const [text, setText] = useState("");
  const [mate, setMate] = useState<Mate>({ name: "", prompt: "", agent: "claude", enabled: true });
  const [repos, setRepos] = useState<string[]>([]);
  const [slack, setSlack] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const check = nameCheck(mate.name || text.trim(), defs);
  const models = options.find((h) => h.harness === mate.agent)?.models ?? [];

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote("");
    try {
      const link = hub.links.find((l) => l.key === where?.key);
      const out = await saveMate(link ? authedOf(link) : api, {
        ...mate,
        prompt: mate.prompt.trim(),
        repos: repos.length > 0 ? repos : undefined,
        avatar: faceOf(mate.name, mate.avatar).id,
        enabled: true,
      }, where && where.machineId ? { machine_id: where.machineId, identity_id: where.id } : undefined);
      const route = "#/mates/" + encodeURIComponent(out.name) + (slack ? "/~slack" : "");
      if (desktop && link) {
        await new Servers(desktop).show(link.key, route);
      } else {
        window.location.hash = route;
      }
    } catch (err) {
      setNote(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mp-new">
      <form className="create" aria-label="New mate" onSubmit={(e) => void create(e)}>
        <h1>New mate</h1>
        <p className="lead">Whose accounts does it use, and where does it run? Pick one environment.</p>
        <div className="composer mp-composer">
          <div className="namel">
            <FaceButton name={mate.name || "nova"} avatar={mate.avatar} color={mate.color} onPick={(patch) => setMate({ ...mate, ...patch })} />
            <input
              aria-label="Name"
              placeholder="name"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setMate({ ...mate, name: mateSlug(e.target.value) });
              }}
            />
            {mate.name !== "" && mate.name !== text && <span className="slug muted">{"Saved as " + mate.name}</span>}
            {check.text && <span className={"pill " + (check.ok ? "ok" : "bad")}>{check.text}</span>}
          </div>
          <textarea aria-label="Role" rows={3} placeholder="What is this mate's role? For example: You are a careful reviewer for the api repo." value={mate.prompt} onChange={(e) => setMate({ ...mate, prompt: e.target.value })} />
          <div className="composer-foot mp-chips-row">
            <ChipMenu
              label={"Harness: " + harnessLabel(mate.agent, mate.model)}
              text={harnessLabel(mate.agent, mate.model)}
              items={[
                { kind: "label" as const, label: "Harness" },
                ...harnesses.map((h) => ({ value: "h:" + h.value, label: h.label, checked: h.value === mate.agent })),
                ...(models.length > 0
                  ? [{ kind: "sep" as const }, { kind: "label" as const, label: "Model" }, ...choices(models, mate.model).map((m) => ({ value: "m:" + m.value, label: m.label, checked: (mate.model ?? "") === m.value }))]
                  : []),
              ]}
              onPick={(v) => {
                if (v.startsWith("h:")) {
                  setMate({ ...mate, agent: v.slice(2), model: undefined });
                } else {
                  setMate({ ...mate, model: v.slice(2) || undefined });
                }
              }}
            />
            <EnvChip state={hub} value={where} onChange={setPick} />
            <ChipMenu
              label={"Repos: " + (repos.length > 0 ? repos.join(", ") : "any")}
              text={"Repos: " + (repos.length > 0 ? repos.join(", ") : "any")}
              items={
                known.length > 0
                  ? known.map((r) => ({ value: r, label: r, checked: repos.includes(r) }))
                  : [{ value: "", label: "No repos yet. Add a workspace in Settings.", disabled: true }]
              }
              onPick={(r) => setRepos(repos.includes(r) ? repos.filter((x) => x !== r) : [...repos, r])}
            />
            <ChipMenu
              label={"Slack: " + (slack ? "connect now" : "later")}
              text={"Slack: " + (slack ? "connect now" : "later")}
              items={[
                { value: "later", label: "Later", checked: !slack },
                { value: "now", label: "Connect now", checked: slack },
              ]}
              onPick={(v) => setSlack(v === "now")}
            />
            <span className="spacer" />
            <Button type="submit" variant="primary" className="mp-create" disabled={busy || !check.ok || mate.prompt.trim() === ""}>
              Create mate
            </Button>
          </div>
        </div>
        {note && <p role="alert">{note}</p>}
        <div className="suggest" aria-label="Role presets" role="group">
          {presets.map((p) => (
            <button key={p.label} type="button" className="mp-chip" onClick={() => setMate({ ...mate, prompt: p.text })}>
              {p.label}
            </button>
          ))}
        </div>
      </form>
    </main>
  );
}

