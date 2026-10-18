import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
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
import { ACCENTS, FACES, type FaceState, faceColor, faceOf, faceState, faceSvg, stateWords, TONES, toneLines, tonePrompt } from "../faces";
import type { MateRow, Mates as MateBoard } from "../stream";
import { ApprovalList } from "./Approvals";

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

export function useMateDefs(api: Authed): { defs: Mate[]; problems: string[]; error: string; reload: () => void } {
  const [defs, setDefs] = useState<Mate[]>([]);
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
  return { defs, problems, error, reload };
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

function firstLine(prompt: string): string {
  return prompt.split("\n")[0].trim();
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
      <section className="kill-switch stopped" aria-label="Kill switch">
        <strong>All mates are stopped.</strong>
        <p className="muted">No mate starts a new turn.</p>
        <button type="button" disabled={busy} onClick={() => flip(false)}>
          Start all mates
        </button>
        {note && <p role="alert">{note}</p>}
      </section>
    );
  }
  return (
    <section className="kill-switch" aria-label="Kill switch">
      {asking ? (
        <>
          <p>Stop all mates? They start no new turns until you start them again.</p>
          <div className="kill-actions">
            <button type="button" disabled={busy} onClick={() => setAsking(false)}>
              Cancel
            </button>
            <button type="button" className="danger" disabled={busy} onClick={() => flip(true)}>
              Stop all
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="danger" onClick={() => setAsking(true)}>
          Stop all mates
        </button>
      )}
      {note && <p role="alert">{note}</p>}
    </section>
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
    <form className="mate-form" onSubmit={submit} aria-label={"Settings of " + start.name}>
      <Brains mate={mate} repos={repos} onMate={setMate} onRepos={setRepos} />
      <label>
        Prompt
        <textarea rows={5} value={mate.prompt} onChange={(e) => setMate({ ...mate, prompt: e.target.value })} />
      </label>
      <button type="submit" disabled={busy || mate.prompt.trim() === ""}>
        Save
      </button>
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
    <label>
      {key === "model" ? "Model" : "Effort"}
      <input value={mate[key] ?? ""} onChange={(e) => onMate({ ...mate, [key]: e.target.value || undefined })} />
    </label>
  );
  return (
    <>
      <label>
        Agent
        <select value={mate.agent} onChange={(e) => onMate({ ...mate, agent: e.target.value })}>
          <option value="claude">claude</option>
          <option value="codex">codex</option>
        </select>
      </label>
      {field("model")}
      {field("effort")}
      <label>
        Repos
        <input value={repos} placeholder="api, web" onChange={(e) => onRepos(e.target.value)} />
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
    <section className="mate-connect" aria-label={"Connect " + name}>
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
        <form onSubmit={submit}>
          <label>
            Bot token
            <input type="password" autoComplete="off" value={bot} onChange={(e) => setBot(e.target.value)} />
          </label>
          <label>
            App token
            <input type="password" autoComplete="off" value={app} onChange={(e) => setApp(e.target.value)} />
          </label>
          <button type="submit" disabled={busy || bot.trim() === "" || app.trim() === ""}>
            Save tokens
          </button>
        </form>
      )}
      {note && <p role="alert">{note}</p>}
    </section>
  );
}

function StateWord({ state }: { state: FaceState }) {
  return (
    <span className={"face-state face-" + state}>
      <span className="dot" aria-hidden="true" />
      {stateWords[state]}
    </span>
  );
}

export function Mates({ api, now, board }: { api: Authed; now: number; board?: MateBoard }) {
  const { defs, problems, error } = useMateDefs(api);
  const asking = useAskingMates(api);
  const rows = board?.mates ?? [];
  return (
    <main className="screen mates">
      <div className="mates-top">
        <h1>Mates</h1>
        <a className="icon-button" href="#/mates/new" aria-label="New mate">
          +
        </a>
      </div>
      {error && <p role="alert">{error}</p>}
      {problems.map((p) => (
        <p key={p} className="mate-error">
          {p}
        </p>
      ))}
      {board === undefined && <p>Loading…</p>}
      {board !== undefined && rows.length === 0 && <p>No mates yet.</p>}
      <div className="mate-grid">
        {rows.map((row) => {
          const def = defs.find((d) => d.name === row.name);
          const state = faceState(row, asking);
          return (
            <a key={row.name} className="mate-card" href={"#/mates/" + encodeURIComponent(row.name)} aria-label={row.name + ", " + stateWords[state]}>
              <MateFace name={row.name} avatar={def?.avatar} color={def?.color} state={state} px={64} />
              <strong className="mate-name">{row.name}</strong>
              {def && <span className="mate-tag">{firstLine(def.prompt)}</span>}
              <StateWord state={state} />
            </a>
          );
        })}
      </div>
      <KillSwitch api={api} stopped={board?.stopped ?? false} />
      <h2>Needs you</h2>
      <ApprovalList api={api} now={now} />
    </main>
  );
}

function Memory({ api, name }: { api: Authed; name: string }) {
  const [memory, setMemory] = useState<MateMemory | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
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

  async function save() {
    setNote("");
    try {
      setMemory(await setMateMemory(api, name, draft ?? ""));
      setDraft(null);
    } catch (err) {
      setNote(message(err));
    }
  }

  return (
    <section className="mate-memory" aria-label={"Memory section of " + name}>
      <div className="sec-row">
        <h2>Memory</h2>
        {draft === null && (
          <button type="button" className="link-button" onClick={() => setDraft(memory?.text ?? "")}>
            Edit memory
          </button>
        )}
      </div>
      {draft === null ? (
        <pre className="mem">{memory?.text ? memory.text : "Empty. " + name + " writes notes here as it learns."}</pre>
      ) : (
        <>
          <textarea aria-label={"Memory of " + name} rows={8} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <p className="muted">
            {new TextEncoder().encode(draft).length} of {memory?.limit ?? 8192} bytes. Empty text clears the memory.
          </p>
          <div className="mate-actions">
            <button type="button" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button type="button" onClick={save}>
              Save memory
            </button>
          </div>
        </>
      )}
      {note && <p role="alert">{note}</p>}
    </section>
  );
}

export function MateProfile({ api, name, board }: { api: Authed; name: string; board?: MateBoard }) {
  const { defs, reload } = useMateDefs(api);
  const asking = useAskingMates(api);
  const [editing, setEditing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const row: MateRow | undefined = board?.mates.find((m) => m.name === name);
  const def = defs.find((d) => d.name === name);

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

  if (!row) {
    return (
      <main className="screen mates">
        <a className="back" href="#/mates">
          ‹ Mates
        </a>
        <p>{board === undefined ? "Loading…" : "There is no mate " + name + "."}</p>
      </main>
    );
  }
  const state = faceState(row, asking);
  const paused = row.state === "paused";
  const local = row.conversations ?? [];
  const chips = def ? [def.agent, def.model, def.effort ? "effort " + def.effort : "", (def.repos ?? []).join(", ")].filter(Boolean) : [];
  return (
    <main className="screen mates mate-profile">
      <a className="back" href="#/mates">
        ‹ Mates
      </a>
      <div className="profile-head">
        <MateFace name={name} avatar={def?.avatar} color={def?.color} state={state} px={112} />
        <h1>{name}</h1>
        <StateWord state={state} />
        {def && <p className="mate-tag">{def.prompt}</p>}
        <div className="tags">
          {chips.map((c) => (
            <span key={c} className="tag">
              {c}
            </span>
          ))}
        </div>
      </div>
      {row.error && <p className="mate-error">{row.error}</p>}
      <button
        type="button"
        className="primary"
        disabled={busy}
        onClick={() =>
          run(async () => {
            const s = await newMateConversation(api, name);
            window.location.hash = "#/sessions/" + encodeURIComponent(s.ID);
          })
        }
      >
        + New conversation
      </button>
      <h2>Conversations</h2>
      {local.length === 0 && row.threads.length === 0 && <p className="muted">No conversations yet.</p>}
      <ul className="mate-threads conv-list" aria-label={"Conversations of " + name}>
        {local.map((c) => (
          <li key={c.id}>
            <a href={"#/sessions/" + encodeURIComponent(c.id)}>
              <span className={"thread-state state-" + (c.ended ? "ended" : c.state)}>{c.ended ? "ended" : c.state}</span> {c.session || c.id}
            </a>
          </li>
        ))}
        {row.threads.map((t) => (
          <li key={t.channel + t.thread_ts}>
            <a href={"#/sessions/" + encodeURIComponent(t.session_id)}>
              <span className={"thread-state state-" + (t.ended ? "ended" : t.state)}>{t.ended ? "ended" : t.state}</span> {t.session || t.session_id}
            </a>
            {t.url && (
              <a href={t.url} target="_blank" rel="noreferrer">
                Slack
              </a>
            )}
          </li>
        ))}
      </ul>
      <Memory api={api} name={name} />
      <div className="mate-actions">
        <button type="button" disabled={busy} onClick={() => run(async () => void (await pauseMate(api, name, !paused)))}>
          {paused ? "Resume" : "Pause"}
        </button>
        {def && (
          <button type="button" onClick={() => setEditing(!editing)}>
            {editing ? "Close settings" : "Settings"}
          </button>
        )}
        {(row.state === "ready" || row.state === "no_tokens") && (
          <button type="button" className="slack-button" onClick={() => setConnecting(!connecting)}>
            <SlackMark px={16} />
            <span>Connect to Slack…</span>
          </button>
        )}
      </div>
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
      {connecting && <Connect api={api} name={name} />}
    </main>
  );
}

const presets: [string, string][] = [
  ["Careful reviewer", "You are a careful code reviewer. Read the whole diff before you comment. Point at exact lines."],
  ["Fast bug fixer", "You fix bugs fast. Make the smallest diff that makes the test pass."],
  ["Patient explainer", "You explain each change as you go, so the owner learns from it."],
  ["Blank", ""],
];

export function NewMate({ api }: { api: Authed }) {
  const [step, setStep] = useState(0);
  const [face, setFace] = useState(FACES[0].id);
  const [color, setColor] = useState("");
  const [mate, setMate] = useState<Mate>({ name: "", prompt: "", agent: "claude", enabled: true });
  const [tone, setTone] = useState([2, 2, 2]);
  const [repos, setRepos] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const chosen = faceOf(mate.name, face);

  async function create() {
    setBusy(true);
    setNote("");
    try {
      const out = await saveMate(api, {
        ...mate,
        prompt: tonePrompt(mate.prompt, tone),
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

  const lines = toneLines(tone);
  return (
    <main className="screen mates new-mate">
      <div className="mates-top">
        <a className="back" href="#/mates">
          ✕ Cancel
        </a>
        <strong>New mate</strong>
      </div>
      <div className="steps" aria-label={"Step " + (step + 1) + " of 3"}>
        {[0, 1, 2].map((i) => (
          <span key={i} className={i <= step ? "on" : ""} />
        ))}
      </div>
      <div className="profile-head">
        <MateFace name={mate.name} avatar={face} color={color} state="idle" px={72} />
      </div>
      {step === 0 && (
        <>
          <h2>1 · Face</h2>
          <div className="face-pick">
            {FACES.map((f) => (
              <button key={f.id} type="button" aria-label={f.name} aria-pressed={f.id === face} className={f.id === face ? "on" : ""} onClick={() => setFace(f.id)}>
                <MateFace name={f.id} state="idle" color={f.id === face ? color : undefined} px={40} />
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
          <label className="field">
            Name
            <input value={mate.name} onChange={(e) => setMate({ ...mate, name: e.target.value.trim().toLowerCase() })} />
          </label>
          <p className="muted">Slack is optional. Connect it later from the profile.</p>
          <button type="button" className="primary" disabled={mate.name === ""} onClick={() => setStep(1)}>
            Next: personality
          </button>
        </>
      )}
      {step === 1 && (
        <>
          <h2>2 · Personality</h2>
          <div className="tags">
            {presets.map(([label, text]) => (
              <button key={label} type="button" className="tag" onClick={() => setMate({ ...mate, prompt: text })}>
                {label}
              </button>
            ))}
          </div>
          <label className="field">
            Prompt
            <textarea rows={5} value={mate.prompt} onChange={(e) => setMate({ ...mate, prompt: e.target.value })} />
          </label>
          <p className="muted">The mate also reads its memory file at the start of each conversation.</p>
          <h2>Tone</h2>
          {TONES.map((t, i) => (
            <div key={t.low} className="tone">
              <span>{t.low}</span>
              <input
                type="range"
                min={0}
                max={4}
                step={1}
                aria-label={t.low + " to " + t.high}
                value={tone[i]}
                onChange={(e) => setTone(tone.map((v, j) => (j === i ? Number(e.target.value) : v)))}
              />
              <span>
                {t.high} <span className="muted">{tone[i] + 1}/5</span>
              </span>
            </div>
          ))}
          <section className="added" aria-label="Added to the prompt">
            <h3>Added to the prompt</h3>
            {TONES.map((t, i) => (
              <p key={t.low} className="arow">
                <span className="muted">
                  {t.low} {tone[i] + 1}/5
                </span>
                <span>{t.steps[tone[i]] ? "“" + t.steps[tone[i]] + "”" : "Middle step. Adds no text."}</span>
              </p>
            ))}
          </section>
          <div className="mate-actions">
            <button type="button" onClick={() => setStep(0)}>
              Back
            </button>
            <button type="button" className="primary" disabled={mate.prompt.trim() === "" && lines.length === 0} onClick={() => setStep(2)}>
              Next: brains
            </button>
          </div>
        </>
      )}
      {step === 2 && (
        <>
          <h2>3 · Brains</h2>
          <form className="mate-form" aria-label="Brains" onSubmit={(e) => (e.preventDefault(), void create())}>
            <Brains mate={mate} repos={repos} onMate={setMate} onRepos={setRepos} />
            <div className="mate-actions">
              <button type="button" onClick={() => setStep(1)}>
                Back
              </button>
              <button type="submit" className="primary" disabled={busy}>
                Create
              </button>
            </div>
          </form>
          {note && <p role="alert">{note}</p>}
        </>
      )}
    </main>
  );
}
