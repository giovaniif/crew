import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useEnvs } from "./Environments";
import { EnvChip, EnvRail } from "./EnvPicker";
import { ThreadChat } from "./Session";
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
  pauseMate,
  saveMate,
  sessionOptions,
  setMateMemory,
  setMateTokens,
  stopAllMates,
} from "../api";
import { ACCENTS, FACES, type FaceState, faceColor, faceOf, faceState, faceSvg, mateCard, mateTagline, type ToneAxis, toneOf } from "../faces";
import { envTitle } from "../envs";
import { mateEnvName } from "../mateshome";
import { type MateAutomation, type ThreadItem, answersIn, harnessLabel, mateAutomations, mateLine, mateRoute, mateSlug, mateThreads, nameCheck, replyHint, threadSearch, toneSteps } from "../matepage";
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

function MoreMenu({ api, name, stopped }: { api: Authed; name: string; stopped: boolean }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  return (
    <span className="ui-anchor">
      <button type="button" className="ui btn quiet mp-more" aria-label={"More for " + name} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        ⋯
      </button>
      {open && (
        <Menu
          label={"More for " + name}
          className="mp-more-menu"
          items={[{ value: "stop", label: stopped ? "Start all mates…" : "Stop all mates…" }]}
          onPick={() => {
            setOpen(false);
            setAsking(true);
          }}
          onClose={() => setOpen(false)}
        />
      )}
      {asking && <StopAll api={api} stopped={stopped} onClose={() => setAsking(false)} />}
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

function FaceGrid({ avatar, color, onPick }: { avatar: string; color?: string; onPick: (patch: { avatar?: string; color?: string }) => void }) {
  const chosen = faceOf(avatar, avatar);
  const shown = faceColor(chosen, color, false);
  return (
    <>
      <div className="mt-faces mp-faces">
        {FACES.map((f) => (
          <button key={f.id} type="button" aria-label={f.name} aria-pressed={f.id === chosen.id} className={f.id === chosen.id ? "on" : ""} onClick={() => onPick({ avatar: f.id })}>
            <MateFace name={f.id} state="idle" color={f.id === chosen.id ? color : undefined} px={24} />
          </button>
        ))}
      </div>
      <div className="swatches">
        {ACCENTS.map((c) => (
          <button key={c} type="button" className={"swatch" + (c === shown ? " on" : "")} aria-label={"Color " + c} style={{ background: c }} onClick={() => onPick({ color: c })} />
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
  const { envs } = useEnvs(api);
  const options = useHarnessOptions(api);
  const [mate, setMate] = useState<Mate>(def);
  const [role, setRole] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(connect);
  const [memOpen, setMemOpen] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => setMate(def), [def]);
  const harness = options.find((h) => h.harness === mate.agent);
  const automations = useMateAutomations(api, name);

  async function save(patch: Partial<Mate>): Promise<boolean> {
    const next = { ...mate, ...patch };
    setMate(next);
    setNote("");
    try {
      await saveMate(api, next);
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
      <EnvRail envs={envs} value={mate.env} onChange={(env) => void save({ env })} />
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

function ThreadRow({ item, href, on }: { item: ThreadItem; href: string; on: boolean }) {
  return (
    <li>
      <a className={"mp-thread" + (on ? " on" : "")} href={href} aria-current={on ? "page" : undefined}>
        <span className={convDot(item.state, item.ended)} aria-hidden="true" />
        <span className="mp-tn">
          <span className="mp-tt">{item.title}</span>
          <span className="mp-ts">{[item.tag, item.ended ? "ended" : item.state].join(" · ")}</span>
        </span>
      </a>
    </li>
  );
}

function convDot(state: string, ended: boolean): string {
  if (ended) {
    return "dot";
  }
  if (state === "running") {
    return "dot run";
  }
  if (state === "permission" || state === "waiting") {
    return "dot wait";
  }
  return state === "done" ? "dot ok" : "dot";
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
  const { envs } = useEnvs(api);
  const asking = useAskingMates(api);
  const mem = useMemory(api, name);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [newNote, setNewNote] = useState("");
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
  const items = mateThreads(row);
  const current = items.find((t) => t.session === thread) ?? items[0];
  const shown = threadSearch(items, search);
  const paused = row.state === "paused";
  const connected = row.state === "connected";
  const canConnect = row.state === "ready" || row.state === "no_tokens";
  const env = envs.find((e) => e.name === mateEnvName(def?.env));
  const envLabel = env ? (env.kind === "local" ? "Local" : envTitle(env)) : mateEnvName(def?.env) === "local" ? "Local" : mateEnvName(def?.env);
  const href = (t: ThreadItem) => "#/mates/" + encodeURIComponent(name) + "/" + encodeURIComponent(t.session);
  const face = (px: number) => <MateFace name={name} avatar={row.avatar || def?.avatar} color={row.color || def?.color} state={state} px={px} />;

  async function start() {
    setBusy(true);
    setNewNote("");
    try {
      const s = await newMateConversation(api, name);
      window.location.hash = "#/mates/" + encodeURIComponent(name) + "/" + encodeURIComponent(s.ID);
    } catch (err) {
      setNewNote(message(err));
    } finally {
      setBusy(false);
    }
  }

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

  const settings = (inSheet: boolean) =>
    def ? (
      <MateSettings api={api} def={def} tones={tones} channels={row.channels} name={name} connected={connected} canConnect={canConnect} connect={connect} mem={mem} sheet={inSheet} onSaved={reload} />
    ) : (
      <p className="mt-note">Loading…</p>
    );

  const conversation = current ? (
    <ThreadChat key={current.session} id={current.session} snapshot={snapshot} client={client} api={api} placeholder={replyHint(current, name)} />
  ) : (
    <p className="mt-note mp-empty">No threads yet. New starts a thread in the app.</p>
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
          <button type="button" className="ui btn quiet mp-info" aria-label={"Settings of " + name} onClick={() => setSheet(true)}>
            ⓘ
          </button>
        </header>
        <nav className="mp-chips" aria-label={"Threads of " + name}>
          <ul>
            {items.map((t) => (
              <li key={t.session}>
                <a className={"mp-chip" + (t === current ? " on" : "")} href={href(t)} aria-current={t === current ? "page" : undefined}>
                  {t.title}
                </a>
              </li>
            ))}
            <li>
              <button type="button" className="mp-chip" aria-label="New thread" disabled={busy} onClick={() => void start()}>
                + New
              </button>
            </li>
          </ul>
          {newNote && <p role="alert">{newNote}</p>}
        </nav>
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
        <span className="muted mp-role-line">{mateTagline(def?.prompt ?? "").split("\n")[0]}</span>
        <span className={"pill mp-state " + state}>{state}</span>
        <span className="spacer" />
        <Button disabled={busy} onClick={() => void pause()}>
          {paused ? "Resume" : "Pause"}
        </Button>
        <MoreMenu api={api} name={name} stopped={board?.stopped ?? false} />
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
        <nav className="mp-threads" aria-label={"Threads of " + name}>
          <div className="mp-search">
            <input type="search" className="ui input" aria-label="Search threads" placeholder="Search threads" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Button aria-label="New thread" disabled={busy} onClick={() => void start()}>
              New
            </Button>
          </div>
          {newNote && <p role="alert">{newNote}</p>}
          <ul>
            {shown.map((t) => (
              <ThreadRow key={t.session} item={t} href={href(t)} on={t === current} />
            ))}
          </ul>
          {items.length > 0 && shown.length === 0 && <p className="mt-note">No thread matches.</p>}
        </nav>
        <section className="mp-conv" aria-label="Conversation">
          {current && (
            <div className="src mp-src">
              <span>{current.tag}</span>
              <span>·</span>
              <span>{current.title}</span>
              <span className="spacer" />
              {current.url && (
                <a href={current.url} target="_blank" rel="noreferrer">
                  Open in Slack
                </a>
              )}
            </div>
          )}
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

export function NewMate({ api, repos: known }: { api: Authed; repos: string[] }) {
  const { defs } = useMateDefs(api);
  const { envs } = useEnvs(api);
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
      const out = await saveMate(api, {
        ...mate,
        prompt: mate.prompt.trim(),
        repos: repos.length > 0 ? repos : undefined,
        avatar: faceOf(mate.name, mate.avatar).id,
        enabled: true,
      });
      window.location.hash = "#/mates/" + encodeURIComponent(out.name) + (slack ? "/~slack" : "");
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
        <p className="lead">A mate is a long-lived agent with a name, a role and its own threads.</p>
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
            <EnvChip envs={envs} value={mate.env} onChange={(env) => setMate({ ...mate, env })} />
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

