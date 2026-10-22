import { type CSSProperties, type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  type Authed,
  type Mate,
  type MateClaim,
  type MateMemory,
  type MateSetup,
  claimMate,
  listApprovals,
  listMates,
  mateMemory,
  mateSetup,
  newMateConversation,
  pauseMate,
  saveMate,
  setMateMemory,
  setMateTokens,
  stopAllMates,
} from "../api";
import {
  ACCENTS,
  FACES,
  type FaceState,
  faceColor,
  faceOf,
  faceState,
  faceSvg,
  gallery,
  mateCard,
  type MateCard,
  type MateSource,
  mateTagline,
  memoryMeter,
  type ToneAxis,
  toneLines,
  toneOf,
} from "../faces";
import type { Mates as MateBoard } from "../stream";
import type { PageVisibility } from "../App";
import { Button, Dialog, Segmented } from "../ui";

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

function KillSwitch({ api, stopped }: { api: Authed; stopped: boolean }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function flip(stop: boolean) {
    setBusy(true);
    setNote("");
    try {
      await stopAllMates(api, stop);
      setAsking(false);
    } catch (err) {
      setNote(message(err));
    } finally {
      setBusy(false);
    }
  }

  if (stopped) {
    return (
      <section className="mt-stopped" aria-label="Kill switch">
        <strong>All mates are stopped.</strong>
        <span className="mt-sub">No mate starts a new turn.</span>
        <Button disabled={busy} onClick={() => void flip(false)}>
          Start all mates
        </Button>
        {note && <p role="alert">{note}</p>}
      </section>
    );
  }
  return (
    <>
      <Button className="mt-small" onClick={() => setAsking(true)}>
        Stop all
      </Button>
      {asking && (
        <Dialog title="Stop all mates?" onClose={() => setAsking(false)}>
          <p>They start no new turns until you start them again.</p>
          {note && (
            <p className="error" role="alert">
              {note}
            </p>
          )}
          <div className="dialog-actions">
            <Button disabled={busy} onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button variant="primary" className="mt-danger-fill" disabled={busy} onClick={() => void flip(true)}>
              Stop all
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function MateForm({ api, start, onSaved }: { api: Authed; start: Mate; onSaved: (m: Mate) => void }) {
  const [mate, setMate] = useState<Mate>(start);
  const [repos, setRepos] = useState((start.repos ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote("");
    try {
      onSaved(await saveMate(api, { ...mate, repos: splitRepos(repos) }));
    } catch (err) {
      setNote(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mt-form mt-panel" onSubmit={submit} aria-label={"Settings of " + start.name}>
      <Brains mate={mate} repos={repos} onMate={setMate} onRepos={setRepos} />
      <label className="mt-field">
        Prompt
        <textarea className="ui input mt-area" rows={5} value={mate.prompt} onChange={(e) => setMate({ ...mate, prompt: e.target.value })} />
      </label>
      <div className="mt-actions">
        <Button type="submit" variant="primary" disabled={busy || mate.prompt.trim() === ""}>
          Save
        </Button>
      </div>
      {note && <p role="alert">{note}</p>}
    </form>
  );
}

function splitRepos(text: string): string[] | undefined {
  const list = text
    .split(",")
    .map((r) => r.trim())
    .filter((r) => r !== "");
  return list.length > 0 ? list : undefined;
}

function Brains({ mate, repos, onMate, onRepos }: { mate: Mate; repos: string; onMate: (m: Mate) => void; onRepos: (r: string) => void }) {
  const field = (key: "model" | "effort") => (
    <label className="mt-field">
      {key === "model" ? "Model" : "Effort"}
      <input className="ui input" value={mate[key] ?? ""} onChange={(e) => onMate({ ...mate, [key]: e.target.value || undefined })} />
    </label>
  );
  return (
    <>
      <div className="mt-field">
        Agent
        <Segmented
          label="Agent"
          value={mate.agent}
          onChange={(agent) => onMate({ ...mate, agent })}
          options={[
            { value: "claude", label: "Claude" },
            { value: "codex", label: "Codex" },
          ]}
        />
      </div>
      <div className="mt-two">
        {field("model")}
        {field("effort")}
      </div>
      <label className="mt-field">
        Repos
        <input className="ui input" value={repos} placeholder="api, web" onChange={(e) => onRepos(e.target.value)} />
      </label>
    </>
  );
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

const sources: { value: MateSource; label: string }[] = [
  { value: "all", label: "All" },
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
];

function agentName(agent: string): string {
  return agent === "codex" ? "Codex" : agent === "claude" ? "Claude" : agent;
}

function subtitle(card: MateCard): string {
  return [card.tagline, card.agent ? agentName(card.agent) : ""].filter(Boolean).join(" · ");
}

function rowDot(card: MateCard): string {
  if (card.face === "needs") {
    return "dot wait";
  }
  if (card.face === "working" || card.face === "thinking") {
    return "dot run";
  }
  return "dot";
}

function MateRowLink({ card, on }: { card: MateCard; on: boolean }) {
  const { row, def } = card;
  return (
    <li>
      <a
        className={"mt-row" + (on ? " on" : "")}
        href={"#/mates/" + encodeURIComponent(row.name)}
        aria-label={row.name + ", " + card.status}
        aria-current={on ? "page" : undefined}
      >
        <MateFace name={row.name} avatar={row.avatar || def?.avatar} color={row.color || def?.color} state={card.face} px={28} />
        <span className="mt-nm">
          <span className="mt-name">{row.name}</span>
          <span className="mt-sub">{subtitle(card)}</span>
        </span>
        {card.face === "paused" ? <span className="mt-pill">paused</span> : <span className={rowDot(card)} aria-hidden="true" />}
      </a>
    </li>
  );
}

function MateList({ api, board, cards, selected }: { api: Authed; board?: MateBoard; cards: MateCard[]; selected?: string }) {
  const [source, setSource] = useState<MateSource>("all");
  const [search, setSearch] = useState("");
  const shown = gallery(cards, source, search);
  const needs = shown.filter((c) => c.face === "needs");
  const rest = shown.filter((c) => c.face !== "needs");
  const rows = board?.mates ?? [];
  return (
    <nav className="mt-list" aria-label="Mates">
      <div className="mt-list-head">
        <div className="mt-title-row">
          <h1>Mates</h1>
          <span className="spacer" />
          {!board?.stopped && <KillSwitch api={api} stopped={false} />}
          <a className="ui btn primary mt-small" href="#/mates/new">
            New mate
          </a>
        </div>
        {board?.stopped && <KillSwitch api={api} stopped />}
        <input type="search" className="ui input" aria-label="Search mates" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Segmented label="Mate sources" value={source} options={sources} onChange={setSource} />
      </div>
      <div className="mt-scroll">
        {board === undefined && <p className="mt-note">Loading…</p>}
        {board !== undefined && rows.length === 0 && <p className="mt-note">No mates yet.</p>}
        {rows.length > 0 && shown.length === 0 && <p className="mt-note">No mate matches.</p>}
        {needs.length > 0 && (
          <>
            <div className="mt-label">Needs you</div>
            <ul className="mt-rows" aria-label="Needs you">
              {needs.map((c) => (
                <MateRowLink key={c.name} card={c} on={c.name === selected} />
              ))}
            </ul>
          </>
        )}
        {rest.length > 0 && <div className="mt-label">All mates</div>}
        {rows.length > 0 && (
          <ul className="mt-rows" aria-label="All mates">
            {rest.map((c) => (
              <MateRowLink key={c.name} card={c} on={c.name === selected} />
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}

function MatesLayout({ api, board, name, picked }: { api: Authed; board?: MateBoard; name?: string; picked: boolean }) {
  const { defs, problems, error, reload } = useMateDefs(api);
  const asking = useAskingMates(api);
  const rows = board?.mates ?? [];
  const cards = rows.map((row) => mateCard(row, defs.find((d) => d.name === row.name), asking));
  const first = [...cards.filter((c) => c.face === "needs"), ...cards.filter((c) => c.face !== "needs")][0];
  const selected = name ?? first?.name;
  const card = cards.find((c) => c.name === selected);
  return (
    <main className={"screen mt-split" + (picked ? " picked" : "")}>
      <MateList api={api} board={board} cards={cards} selected={selected} />
      <section className="mt-prof" aria-label="Profile">
        {picked && (
          <a className="back mt-back" href="#/mates">
            ‹ Mates
          </a>
        )}
        {error && <p role="alert">{error}</p>}
        {problems.map((p) => (
          <p key={p} className="mt-error">
            {p}
          </p>
        ))}
        {card ? (
          <Profile key={card.name} api={api} card={card} asking={asking} reload={reload} />
        ) : name !== undefined ? (
          <p className="mt-note">{board === undefined ? "Loading…" : "There is no mate " + name + "."}</p>
        ) : null}
      </section>
    </main>
  );
}

export function Mates({ api, board }: { api: Authed; now?: number; board?: MateBoard; visibility?: PageVisibility }) {
  return <MatesLayout api={api} board={board} picked={false} />;
}

export function MateProfile({ api, name, board }: { api: Authed; name: string; board?: MateBoard }) {
  return <MatesLayout api={api} board={board} name={name} picked />;
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

function Fact({ label, children, sub }: { label: ReactNode; children: ReactNode; sub: ReactNode }) {
  return (
    <div className="mt-fact" role="group" aria-label={typeof label === "string" ? label : undefined}>
      <div className="k">{label}</div>
      <div className="v">{children}</div>
      <div className="s">{sub}</div>
    </div>
  );
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

function convDot(state: string, ended: boolean): string {
  if (ended) {
    return "dot";
  }
  if (state === "running") {
    return "dot run";
  }
  if (state === "permission") {
    return "dot ask";
  }
  if (state === "waiting") {
    return "dot wait";
  }
  return state === "done" ? "dot ok" : "dot";
}

function Profile({ api, card, asking, reload }: { api: Authed; card: MateCard; asking: string[]; reload: () => void }) {
  const { row, def } = card;
  const name = row.name;
  const mem = useMemory(api, name);
  const [editing, setEditing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [startNote, setStartNote] = useState("");
  const state = faceState(row, asking);
  const paused = row.state === "paused";
  const local = row.conversations ?? [];
  const meter = memoryMeter(mem.memory?.text ?? "", mem.memory?.limit ?? 8192);
  const bytes = new TextEncoder().encode(mem.memory?.text ?? "").length;
  const repos = def?.repos ?? [];
  const canConnect = row.state === "ready" || row.state === "no_tokens";

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setNote("");
    try {
      await work();
    } catch (err) {
      setNote(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function save(text: string): Promise<boolean> {
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
    <div className="mt-profile">
      <div className="mt-head">
        <MateFace name={name} avatar={row.avatar || def?.avatar} color={row.color || def?.color} state={state} px={56} />
        <div className="mt-nm">
          <h2>{name}</h2>
          <div className="mt-sub">{[card.tagline, card.status].filter(Boolean).join(" · ")}</div>
        </div>
        <span className="spacer" />
        <Button disabled={busy} onClick={() => void run(async () => void (await pauseMate(api, name, !paused)))}>
          {paused ? "Resume" : "Pause"}
        </Button>
        {def && <Button onClick={() => setEditing(!editing)}>{editing ? "Close settings" : "Settings"}</Button>}
      </div>
      {row.error && <p className="mt-error">{row.error}</p>}
      {note && <p role="alert">{note}</p>}
      {editing && def && (
        <MateForm
          api={api}
          start={def}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}
      <div className="mt-facts">
        <Fact label="Agent" sub={def?.effort ? "effort " + def.effort : "default effort"}>
          {def ? [agentName(def.agent), def.model].filter(Boolean).join(" · ") : "—"}
        </Fact>
        <Fact label="Repos" sub={repos.length > 0 ? repos[0] + " is the default" : "The first repo of each conversation"}>
          {repos.length > 0 ? repos.join(", ") : "Any repo"}
        </Fact>
        <Fact
          label="Memory"
          sub={<meter aria-label="Memory size" min={0} max={mem.memory?.limit ?? 8192} value={bytes} aria-valuenow={bytes} aria-valuemin={0} aria-valuemax={mem.memory?.limit ?? 8192} />}
        >
          <span className={meter.full ? "mt-full" : undefined}>{meter.label}</span>
        </Fact>
        <div className="mt-fact" role="group" aria-label="Slack">
          <div className="k">
            <SlackMark px={11} /> Slack
          </div>
          <div className="v">{row.state === "connected" ? "Connected" : "Not connected"}</div>
          <div className="s">
            {canConnect ? (
              <button type="button" className="mt-link" onClick={() => setConnecting(!connecting)}>
                Connect…
              </button>
            ) : (
              row.state.replaceAll("_", " ")
            )}
          </div>
        </div>
      </div>
      {connecting && <Connect api={api} name={name} />}
      <div className="mt-section">
        <h2>Conversations</h2>
        <span className="spacer" />
        <Button
          variant="quiet"
          className="mt-tiny"
          disabled={busy}
          onClick={() => {
            setStartNote("");
            void run(async () => {
              try {
                const s = await newMateConversation(api, name);
                window.location.hash = "#/sessions/" + encodeURIComponent(s.ID);
              } catch (err) {
                setStartNote(message(err));
              }
            });
          }}
        >
          + New conversation
        </Button>
        {startNote && <p role="alert">{startNote}</p>}
      </div>
      {local.length === 0 && row.threads.length === 0 ? (
        <p className="mt-note">No conversations yet.</p>
      ) : (
        <ul className="mt-convs" aria-label={"Conversations of " + name}>
          {local.map((c) => (
            <li key={c.session}>
              <span className={convDot(c.state, c.ended)} aria-hidden="true" />
              <span className="mt-nm">
                <span className="mt-name">{c.name || c.session}</span>
                <span className="mt-sub">{c.ended ? "ended" : c.state}</span>
              </span>
              <a className="ui btn quiet mt-tiny" href={"#/sessions/" + encodeURIComponent(c.session)} aria-label={"Open " + (c.name || c.session)}>
                Open
              </a>
            </li>
          ))}
          {row.threads.map((t) => (
            <li key={t.channel + t.thread_ts}>
              <span className={convDot(t.state, t.ended)} aria-hidden="true" />
              <span className="mt-nm">
                <span className="mt-name">{t.session || t.session_id}</span>
                <span className="mt-sub">
                  {t.ended ? "ended" : t.state}
                  {t.url && (
                    <>
                      {" · "}
                      <a href={t.url} target="_blank" rel="noreferrer">
                        Slack
                      </a>
                    </>
                  )}
                </span>
              </span>
              <a className="ui btn quiet mt-tiny" href={"#/sessions/" + encodeURIComponent(t.session_id)} aria-label={"Open " + (t.session || t.session_id)}>
                Open
              </a>
            </li>
          ))}
        </ul>
      )}
      <Memory name={name} mem={mem} save={save} />
    </div>
  );
}

const presets: { label: string; detail: string; text: string }[] = [
  { label: "Careful reviewer", detail: "Reads first, asks before big changes", text: "You are a careful code reviewer. Read the whole diff before you comment. Point at exact lines." },
  { label: "Fast bug fixer", detail: "Small fix, test, done", text: "You fix bugs fast. Make the smallest diff that makes the test pass." },
  { label: "Patient explainer", detail: "Teaches while it works", text: "You explain each change as you go, so the owner learns from it." },
  { label: "Blank", detail: "No extra prompt", text: "" },
];

function brainsLine(mate: Mate): string {
  return [agentName(mate.agent), mate.model, mate.effort ? mate.effort + " effort" : ""].filter(Boolean).join(" · ");
}

const mateHandle = /^[a-z0-9][a-z0-9_-]*$/;

function nameProblemOf(name: string, defs: Mate[]): string {
  if (name === "") {
    return "";
  }
  if (name.length > 32 || !mateHandle.test(name)) {
    return "Use up to 32 letters, digits, - and _.";
  }
  return defs.some((d) => d.name === name) ? "A mate named " + name + " exists." : "";
}

export function NewMate({ api }: { api: Authed }) {
  const { defs, tones } = useMateDefs(api);
  const [step, setStep] = useState(0);
  const [face, setFace] = useState(FACES[0].id);
  const [color, setColor] = useState("");
  const [mate, setMate] = useState<Mate>({ name: "", prompt: "", agent: "claude", enabled: true });
  const [preset, setPreset] = useState("");
  const [tone, setTone] = useState([2, 2, 2]);
  const [repos, setRepos] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const chosen = faceOf(mate.name, face);
  const nameProblem = nameProblemOf(mate.name, defs);

  function pickFace(id: string) {
    const previous = FACES.find((f) => f.id === face)?.name.toLowerCase();
    const next = FACES.find((f) => f.id === id);
    if (next && (mate.name === "" || mate.name === previous)) {
      setMate({ ...mate, name: next.name.toLowerCase() });
    }
    setFace(id);
  }

  async function create() {
    setBusy(true);
    setNote("");
    try {
      const out = await saveMate(api, {
        ...mate,
        prompt: mate.prompt.trim(),
        tone: toneOf(tones, tone),
        repos: splitRepos(repos),
        avatar: face,
        color: color || undefined,
        enabled: true,
      });
      window.location.hash = "#/mates/" + encodeURIComponent(out.name);
    } catch (err) {
      setNote(message(err));
    } finally {
      setBusy(false);
    }
  }

  const lines = toneLines(tones, tone);
  const nav = (back: number | null, next: ReactNode) => (
    <div className="mt-actions">
      {back !== null && (
        <Button variant="quiet" onClick={() => setStep(back)}>
          Back
        </Button>
      )}
      {next}
    </div>
  );
  const head = (title: string) => (
    <div className="mt-wiz-title">
      <MateFace name={mate.name} avatar={face} color={color} state="idle" px={28} />
      <h2>{title}</h2>
    </div>
  );
  return (
    <main className="screen mt-new">
      <div className="mt-bar">
        <a className="ui btn quiet" href="#/mates">
          Cancel
        </a>
        <span className="spacer" />
        <strong>New mate</strong>
        <span className="spacer" />
        <span className="mt-bar-pad" />
      </div>
      <div className="mt-wiz">
        <div className="mt-steps" role="progressbar" aria-label={"Step " + (step + 1) + " of 4"} aria-valuemin={1} aria-valuemax={4} aria-valuenow={step + 1}>
          {[0, 1, 2, 3].map((i) => (
            <i key={i} className={i <= step ? "on" : ""} />
          ))}
        </div>
        <div className="mt-wiz-body">
          {step === 0 && (
            <>
              {head("Pick a face")}
              <div className="mt-faces">
                {FACES.map((f) => (
                  <button key={f.id} type="button" aria-label={f.name} aria-pressed={f.id === face} className={f.id === face ? "on" : ""} onClick={() => pickFace(f.id)}>
                    <MateFace name={f.id} state="idle" color={f.id === face ? color : undefined} px={36} />
                  </button>
                ))}
              </div>
              <div className="swatches">
                {ACCENTS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={"swatch" + (c === faceColor(chosen, color, false) ? " on" : "")}
                    aria-label={"Color " + c}
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
              <label className="mt-field">
                Name
                <input className="ui input" value={mate.name} onChange={(e) => setMate({ ...mate, name: e.target.value.trim().toLowerCase() })} />
              </label>
              {nameProblem && <p className="mt-error">{nameProblem}</p>}
              <p className="mt-sub">Slack is optional. Connect it later from the profile.</p>
              {nav(
                null,
                <Button variant="primary" disabled={mate.name === "" || nameProblem !== ""} onClick={() => setStep(1)}>
                  Next
                </Button>,
              )}
            </>
          )}
          {step === 1 && (
            <>
              {head("How should " + mate.name + " work?")}
              <div className="mt-presets" role="radiogroup" aria-label="Presets">
                {presets.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    role="radio"
                    aria-checked={preset === p.label}
                    className={"mt-preset" + (preset === p.label ? " on" : "")}
                    onClick={() => {
                      setPreset(p.label);
                      setMate({ ...mate, prompt: p.text });
                    }}
                  >
                    <span className="t">{p.label}</span>
                    <span className="s">{p.detail}</span>
                  </button>
                ))}
              </div>
              <label className="mt-field">
                Prompt
                <textarea className="ui input mt-area" rows={4} value={mate.prompt} onChange={(e) => setMate({ ...mate, prompt: e.target.value })} />
              </label>
              <p className="mt-sub">The mate also reads its memory file at the start of each conversation.</p>
              {tones.map((t, i) => (
                <div key={t.key} className="mt-slider">
                  <span>{t.low}</span>
                  <input
                    type="range"
                    min={0}
                    max={4}
                    step={1}
                    aria-label={t.low + " to " + t.high}
                    value={tone[i]}
                    style={{ "--at": tone[i] * 25 + "%" } as CSSProperties}
                    onChange={(e) => setTone(tone.map((v, j) => (j === i ? Number(e.target.value) : v)))}
                  />
                  <span className="hi">{t.high}</span>
                </div>
              ))}
              <section className="mt-added" aria-label="Added to the prompt">
                <h3>Added to the prompt</h3>
                {tones.map((t, i) => (
                  <p key={t.key} className="mt-arow">
                    <span className="mt-sub">
                      {t.low} {tone[i] + 1}/5
                    </span>
                    <span>{t.steps[tone[i]] ? "“" + t.steps[tone[i]] + "”" : "Middle step. Adds no text."}</span>
                  </p>
                ))}
              </section>
              {mate.prompt.trim() === "" && <p className="mt-error">Write a personality prompt or pick a preset.</p>}
              {nav(
                0,
                <Button variant="primary" disabled={mate.prompt.trim() === ""} onClick={() => setStep(2)}>
                  Next
                </Button>,
              )}
            </>
          )}
          {step === 2 && (
            <form className="mt-form" aria-label="Brains" onSubmit={(e) => (e.preventDefault(), setStep(3))}>
              {head("Which brains does " + mate.name + " use?")}
              <Brains mate={mate} repos={repos} onMate={setMate} onRepos={setRepos} />
              {nav(
                1,
                <Button type="submit" variant="primary">
                  Next
                </Button>,
              )}
            </form>
          )}
          {step === 3 && (
            <>
              <div className="mt-wiz-title">
                <MateFace name={mate.name} avatar={face} color={color} state="idle" px={56} />
                <h2>Meet {mate.name}</h2>
              </div>
              {mateTagline(mate.prompt) && <p className="mt-sub">{mateTagline(mate.prompt)}</p>}
              {lines.length > 0 && (
                <div className="mt-tags">
                  {tones.map((t, i) =>
                    tone[i] === 2 ? null : (
                      <span key={t.key} className="mt-pill">
                        {tone[i] < 2 ? t.low : t.high}
                      </span>
                    ),
                  )}
                </div>
              )}
              <div className="mt-facts three" aria-label={"About " + mate.name} role="region">
                <Fact label="Agent" sub="">
                  {brainsLine(mate)}
                </Fact>
                <Fact label="Repos" sub="">
                  {splitRepos(repos)?.join(", ") ?? "The first repo of each conversation"}
                </Fact>
                <Fact label="Memory" sub="">
                  Empty. {mate.name} writes notes here as it learns.
                </Fact>
              </div>
              <p className="mt-sub">{mate.name} starts with fresh context in each conversation and keeps its personality and memory.</p>
              <p className="mt-sub">Slack is optional. Connect it later from the profile.</p>
              {nav(
                2,
                <Button variant="primary" disabled={busy} onClick={() => void create()}>
                  Create
                </Button>,
              )}
              {note && <p role="alert">{note}</p>}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
