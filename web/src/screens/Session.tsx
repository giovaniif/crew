import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import Markdown from "react-markdown";
import { ApiError, answerPrompt, getPrompt, interrupt, markRead, messagesPage, sendMessage, startFresh, unsend, type Authed, type Prompt } from "../api";
import { faceColor, faceOf, faceState, stateWords, type FaceState } from "../faces";
import { messageSource } from "../matepage";
import { MateFace, useMateDefs } from "./Mates";
import { timeInState } from "../sessions";
import type { Message, QueuedSend, Session, StreamClient, StreamSnapshot, StreamStatus } from "../stream";
import { emptyTranscript, newestCursor, toolRow, withFrame, withPage, type Transcript } from "../transcript";
import { Connection, sessionTitle } from "./SessionList";
import { SessionCommands } from "./SessionCommands";
import type { KeyValue } from "../auth";
import { legacyBrowserWord } from "../legacy";

const stateLabels: Record<string, string> = {
  running: "working",
  permission: "needs permission",
  waiting: "waiting for you",
  done: "done",
  idle: "idle",
};

const nearTop = 120;
const nearBottom = 80;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function stateOf(s: Session): string {
  return s.Ended ? "ended" : s.State;
}

function busy(s: Session): boolean {
  return s.State === "running" || s.State === "permission";
}

function Back() {
  return (
    <a className="back" href="#/sessions">
      <span aria-hidden="true">{"‹ "}</span>
      Sessions
    </a>
  );
}

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function InterruptButton({ api, session }: { api: Authed; session: string }) {
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const stop = useCallback(async () => {
    setStopping(true);
    setError("");
    try {
      await interrupt(api, session);
    } catch (err) {
      setError(errorText(err));
      setStopping(false);
    }
  }, [api, session]);
  useEffect(() => {
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.key !== "Escape" || ev.defaultPrevented || stopping || typing(ev.target)) {
        return;
      }
      if (document.querySelector("[role=dialog], [role=alertdialog], [role=menu]")) {
        return;
      }
      void stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stop, stopping]);
  const label = stopping ? "Interrupting…" : "Interrupt";
  return (
    <>
      {error ? (
        <span className="qb-error" role="alert">
          {error}
        </span>
      ) : null}
      <button type="button" className="qb stop" aria-label={label} title={label} disabled={stopping} onClick={() => void stop()}>
        <span className="sq" aria-hidden="true" />
        <span className="qb-label">{label}</span>
        {stopping ? null : <kbd aria-hidden="true">esc</kbd>}
      </button>
    </>
  );
}

function Header({
  session,
  now,
  api,
  mate,
  commands,
  inBar,
}: {
  session: Session;
  now: number;
  api: Authed;
  mate?: ReactNode;
  commands?: ReactNode;
  inBar?: boolean;
}) {
  const age = timeInState(session.since, now);
  const state = stateOf(session);
  const meta = [session.where, [session.Harness, session.Model].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
  return (
    <header className={"chat-top" + (inBar ? " in-bar" : "")}>
      <div className="chat-bar" role="toolbar" aria-label="Session">
        {inBar ? null : <Back />}
        {mate}
        {busy(session) && !session.Ended ? <InterruptButton key={session.ID} api={api} session={session.ID} /> : null}
        {commands}
      </div>
      {inBar ? null : <h1>{sessionTitle(session)}</h1>}
      {inBar ? null : <p className="meta">{meta}</p>}
      <p className="chat-facts">
        <span className={"chip chip-" + state}>{stateLabels[state] ?? state}</span>
        {session.Muted ? <span className="badge muted-badge">muted</span> : null}
        {session.Usage.HasContext ? <span>{session.Usage.ContextLeftPercent + "% context left"}</span> : null}
        {age ? <span>{age}</span> : null}
      </p>
      {session.banner ? <p className="banner">{session.banner}</p> : null}
    </header>
  );
}

function ToolLine({ message }: { message: Message }) {
  const row = toolRow(message);
  const label = [row.name, row.detail].filter(Boolean).join(" ");
  return (
    <details data-message className={"tool tool-" + row.status} role="group" aria-label={label}>
      <summary>
        <span className="tool-dot" aria-hidden="true" />
        <span className="tool-name">{row.name}</span>
        <span className="tool-detail">{row.detail}</span>
        {row.status === "running" ? <span className="live">running</span> : null}
        {row.status === "failed" ? <span className="failed">failed</span> : null}
        {row.result ? <span className="tool-result">{row.result}</span> : null}
      </summary>
      {message.text ? <pre className="tool-output">{message.text}</pre> : <p className="muted">No output yet</p>}
    </details>
  );
}

type Persona = { name: string; avatar?: string; color?: string; state: FaceState };

function personaOf(session: Session, snapshot: StreamSnapshot): Persona | undefined {
  const mate = session.Mate?.Name;
  if (!mate) {
    return undefined;
  }
  const row = snapshot.state?.mates?.mates.find((m) => m.name === mate);
  return { name: mate, avatar: row?.avatar, color: row?.color, state: row ? faceState(row, []) : "idle" };
}

function mateTint(persona: Persona): string {
  return faceColor(faceOf(persona.name, persona.avatar), persona.color, false);
}

function shownName(name: string) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function MessageLine({ message, persona }: { message: Message; persona?: Persona }) {
  if (message.role === "tool" || message.tool) {
    return <ToolLine message={message} />;
  }
  if (message.role === "user") {
    if (persona) {
      const src = messageSource(message.text ?? "");
      return (
        <div data-message className="msg msg-user">
          <span className="msg-src">{src.tag}</span>
          <p>{src.text}</p>
        </div>
      );
    }
    return (
      <div data-message className="msg msg-user">
        <p>{message.text}</p>
      </div>
    );
  }
  if (message.role === "system") {
    return (
      <div data-message className="msg msg-system">
        <p>{message.text}</p>
      </div>
    );
  }
  if (persona) {
    const name = shownName(persona.name);
    return (
      <article data-message className="msg-mate" aria-label={name} style={{ "--mate": mateTint(persona) } as CSSProperties}>
        <MateFace name={persona.name} avatar={persona.avatar} color={persona.color} state={persona.state} px={28} />
        <div className="msg-mate-body">
          <div className="msg msg-assistant msg-bubble">
            <Markdown skipHtml>{message.text ?? ""}</Markdown>
          </div>
        </div>
      </article>
    );
  }
  return (
    <div data-message className="msg msg-assistant">
      <Markdown skipHtml>{message.text ?? ""}</Markdown>
    </div>
  );
}

function OlderRow({ t, loading, failed, onLoad }: { t: Transcript; loading: boolean; failed: boolean; onLoad: () => void }) {
  if (!t.loaded) {
    return <div className="older" />;
  }
  if (loading) {
    return (
      <div className="older" role="status">
        Loading earlier messages…
      </div>
    );
  }
  if (t.before === 0) {
    return <div className="older muted">Start of the conversation</div>;
  }
  return (
    <div className="older">
      <button type="button" className="load-older" onClick={onLoad}>
        {failed ? "Couldn’t load earlier messages · Retry" : "Load earlier messages"}
      </button>
    </div>
  );
}

const browserCommand = new RegExp(`\\b(crew|${legacyBrowserWord}) browser\\b`);

export function usesBrowser(messages: Message[]): boolean {
  return messages.some((m) => m.role === "tool" && browserCommand.test(m.tool?.summary ?? ""));
}

function useEarlier(api: Authed, freshFrom?: string): Message[] {
  const [earlier, setEarlier] = useState<Message[]>([]);
  const { fetch, token } = api;
  useEffect(() => {
    setEarlier([]);
    if (!freshFrom) {
      return;
    }
    let alive = true;
    messagesPage({ fetch, token }, freshFrom).then(
      (page) => {
        if (alive) {
          setEarlier([...page.messages].sort((a, b) => a.cursor - b.cursor));
        }
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [fetch, token, freshFrom]);
  return earlier;
}

function Handoff() {
  const label = "Earlier conversation ended · handoff saved to memory";
  return (
    <div className="chat-handoff" role="separator" aria-label={label}>
      <span>{label}</span>
    </div>
  );
}

function Chat({ id, client, api, status, persona, freshFrom, onBrowser, children }: { id: string; client: StreamClient; api: Authed; status: StreamStatus; persona?: Persona; freshFrom?: string; onBrowser?: () => void; children?: ReactNode }) {
  const earlier = useEarlier(api, freshFrom);
  const [t, setT] = useState<Transcript>(emptyTranscript);
  const [loadError, setLoadError] = useState("");
  const [older, setOlder] = useState<"idle" | "loading" | "failed">("idle");
  const [watchError, setWatchError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const loadingOlder = useRef(false);
  const generation = useRef(0);
  const latest = useRef(t);
  latest.current = t;
  const { fetch, token } = api;
  const browsing = usesBrowser(t.messages);

  useEffect(() => {
    if (browsing && onBrowser) {
      onBrowser();
    }
  }, [browsing, onBrowser]);

  useEffect(() => {
    let alive = true;
    const gen = generation.current;
    messagesPage({ fetch, token }, id).then(
      (page) => {
        if (alive && gen === generation.current) {
          setLoadError("");
          setT((cur) => withPage(cur, page));
        }
      },
      (err: unknown) => {
        if (alive) {
          setLoadError(errorText(err));
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [fetch, token, id, attempt]);

  useEffect(
    () =>
      client.onFrame((frame) => {
        if (frame.transcript && frame.transcript.session === id) {
          const tf = frame.transcript;
          setWatchError("");
          if (tf.reset) {
            generation.current++;
            setAttempt((n) => n + 1);
          }
          setT((cur) => withFrame(cur, tf));
        } else if (frame.error && frame.watch === id) {
          setWatchError(frame.error.message);
        }
      }),
    [client, id],
  );

  useEffect(() => {
    if (status === "live" && t.loaded) {
      client.send({ watch: id, after: newestCursor(latest.current) });
    }
  }, [client, id, status, t.loaded]);

  useEffect(
    () => () => {
      client.send({ unwatch: id });
    },
    [client, id],
  );

  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el) {
      return;
    }
    if (anchor.current) {
      el.scrollTop = anchor.current.top + el.scrollHeight - anchor.current.height;
      anchor.current = null;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [t.messages]);

  const loadOlder = useCallback(() => {
    const cur = latest.current;
    if (!cur.loaded || cur.before === 0 || loadingOlder.current) {
      return;
    }
    loadingOlder.current = true;
    setOlder("loading");
    const gen = generation.current;
    messagesPage({ fetch, token }, id, cur.before ?? undefined).then(
      (page) => {
        loadingOlder.current = false;
        if (gen !== generation.current) {
          setOlder("idle");
          return;
        }
        const el = logRef.current;
        if (el) {
          anchor.current = { height: el.scrollHeight, top: el.scrollTop };
        }
        setOlder("idle");
        setT((c) => withPage(c, page));
      },
      () => {
        loadingOlder.current = false;
        setOlder(gen !== generation.current ? "idle" : "failed");
      },
    );
  }, [fetch, token, id]);

  const onScroll = () => {
    const el = logRef.current;
    if (!el) {
      return;
    }
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < nearBottom;
    if (el.scrollTop < nearTop) {
      loadOlder();
    }
  };

  return (
    <div className={"chat-log" + (persona ? " mate-log" : "")} style={persona ? ({ "--mate": mateTint(persona) } as CSSProperties) : undefined} role="log" aria-label="Messages" ref={logRef} onScroll={onScroll}>
      <OlderRow t={t} loading={older === "loading"} failed={older === "failed"} onLoad={loadOlder} />
      {loadError ? (
        <div className="error chat-error">
          <span>{"Couldn’t load messages: " + loadError}</span>
          <button type="button" className="retry" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </div>
      ) : null}
      {earlier.map((m) => (
        <MessageLine key={"earlier-" + m.id} message={m} persona={persona} />
      ))}
      {freshFrom ? <Handoff /> : null}
      {t.loaded && t.messages.length === 0 ? <p className="muted chat-empty">No messages yet</p> : null}
      {t.messages.map((m) => (
        <MessageLine key={m.id} message={m} persona={persona} />
      ))}
      {watchError ? <p className="error">{"Live updates stopped: " + watchError}</p> : null}
      {browsing && !onBrowser ? (
        <p className="browser-note" role="note">
          This session uses the browser of the Mac app. The phone app cannot show that browser. Open the session in the Mac app to see it.
        </p>
      ) : null}
      <div className="chat-end">{children}</div>
    </div>
  );
}

type Phase =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; prompt: Prompt }
  | { kind: "unparsed"; raw: string }
  | { kind: "answering"; prompt: Prompt; choice: string }
  | { kind: "answered"; label: string }
  | { kind: "gone" }
  | { kind: "failed"; message: string };

function PermissionCard({ api, session }: { api: Authed; session: Session }) {
  const asking = session.State === "permission" && !session.Ended;
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const { fetch, token } = api;
  const id = session.ID;

  useEffect(() => {
    if (!asking) {
      setPhase((p) => (p.kind === "ready" || p.kind === "unparsed" || p.kind === "answering" ? { kind: "gone" } : p.kind === "loading" || p.kind === "failed" ? { kind: "idle" } : p));
      return;
    }
    generation.current++;
    let alive = true;
    setPhase({ kind: "loading" });
    setError("");
    getPrompt({ fetch, token }, id).then(
      (prompt) => {
        if (!alive) {
          return;
        }
        setPhase(prompt.choices.length === 0 && prompt.raw ? { kind: "unparsed", raw: prompt.raw } : { kind: "ready", prompt });
      },
      (err: unknown) => {
        if (alive) {
          setPhase(err instanceof ApiError && err.code === "not_found" ? { kind: "gone" } : { kind: "failed", message: errorText(err) });
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [fetch, token, id, asking, session.since, attempt]);

  const choose = async (prompt: Prompt, choice: string) => {
    const gen = generation.current;
    setPhase({ kind: "answering", prompt, choice });
    setError("");
    try {
      await answerPrompt({ fetch, token }, id, choice, prompt.id);
      if (gen === generation.current) {
        setPhase({ kind: "answered", label: prompt.choices.find((c) => c.id === choice)?.label ?? choice });
      }
    } catch (err) {
      if (gen !== generation.current) {
        return;
      }
      if (err instanceof ApiError && (err.code === "stale" || err.code === "not_found")) {
        setPhase({ kind: "gone" });
      } else {
        setError(errorText(err));
        setPhase({ kind: "ready", prompt });
      }
    }
  };

  if (phase.kind === "idle") {
    return null;
  }
  if (phase.kind === "loading") {
    return (
      <section className="permission" aria-label="Permission request" role="status">
        Loading the permission request…
      </section>
    );
  }
  if (phase.kind === "failed") {
    return (
      <section className="permission error" aria-label="Permission request">
        <span>{"Couldn’t load the prompt: " + phase.message}</span>
        <button type="button" className="retry" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </button>
      </section>
    );
  }
  if (phase.kind === "gone") {
    return (
      <section className="permission permission-gone" aria-label="Permission request">
        <p>This prompt is gone. It was already answered, probably in the terminal, so nothing was sent.</p>
      </section>
    );
  }
  if (phase.kind === "answered") {
    return (
      <section className="permission permission-gone" aria-label="Permission request">
        <p>{"Answered: " + phase.label}</p>
      </section>
    );
  }
  if (phase.kind === "unparsed") {
    return (
      <section className="permission" aria-label="Permission request">
        <h2>Couldn’t read this dialog</h2>
        <p className="muted">Answer it in the terminal. This is what the pane shows:</p>
        <pre className="permission-raw">{phase.raw}</pre>
      </section>
    );
  }
  const prompt = phase.prompt;
  const answering = phase.kind === "answering";
  return (
    <section className="permission" aria-label="Permission request">
      <h2>
        <span className="dot ask" aria-hidden="true" />
        Permission needed
      </h2>
      <pre className="permission-text">{prompt.text}</pre>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="permission-choices">
        {prompt.choices.map((c, i) => (
          <button key={c.id} type="button" className={"ui btn permission-choice" + (i === 0 ? " primary" : "")} disabled={answering} onClick={() => void choose(prompt, c.id)}>
            {c.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function Queued({ sends, onEdit, onDrop }: { sends: QueuedSend[]; onEdit: (s: QueuedSend) => void; onDrop: (s: QueuedSend) => void }) {
  if (sends.length === 0) {
    return null;
  }
  return (
    <ul className="queued" aria-label="Queued">
      {sends.map((s) => (
        <li key={s.id}>
          <span className="queued-label">Queued</span>
          <span className="queued-text">{s.text}</span>
          <button type="button" className="ui icon-btn queued-action" title="Edit" aria-label={"Edit: " + s.text} onClick={() => onEdit(s)}>
            ✎
          </button>
          <button type="button" className="ui icon-btn queued-action" title="Drop" aria-label={"Drop: " + s.text} onClick={() => onDrop(s)}>
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}

function Composer({ session, api, sends, persona, placeholder }: { session: Session; api: Authed; sends: QueuedSend[]; persona?: Persona; placeholder?: string }) {
  const locked = session.State === "permission" && !session.Ended;
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const blank = draft.trim() === "";

  const submit = async (ev: FormEvent | KeyboardEvent<HTMLTextAreaElement>) => {
    ev.preventDefault();
    if (blank || posting || locked) {
      return;
    }
    setPosting(true);
    setError("");
    const sent = draft;
    try {
      await sendMessage(api, session.ID, sent);
      setDraft((cur) => (cur === sent ? "" : cur));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPosting(false);
    }
  };

  const onKey = (ev: KeyboardEvent<HTMLTextAreaElement>) => {
    if (ev.key !== "Enter" || ev.shiftKey || ev.nativeEvent.isComposing || ev.keyCode === 229) {
      return;
    }
    void submit(ev);
  };

  const takeBack = async (s: QueuedSend, edit: boolean) => {
    setError("");
    try {
      await unsend(api, session.ID, s.id);
      if (edit) {
        setDraft((cur) => (cur.trim() ? cur + "\n\n" + s.text : s.text));
      }
    } catch (err) {
      setError(err instanceof ApiError && err.code === "not_found" ? "That message was already sent." : errorText(err));
    }
  };

  return (
    <footer className="composer">
      <Queued sends={sends} onEdit={(s) => void takeBack(s, true)} onDrop={(s) => void takeBack(s, false)} />
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <form className="composer-box" onSubmit={(ev) => void submit(ev)}>
        <textarea aria-label="Message" rows={1} value={draft} placeholder={placeholder ? placeholder : busy(session) ? "Queue a message…" : persona ? "Message " + shownName(persona.name) + "…" : "Reply to the agent…"} onChange={(ev) => setDraft(ev.target.value)} onKeyDown={onKey} />
        <div className="composer-foot" role="group" aria-label="Composer options">
          <span className="composer-chip">{agentChip(session)}</span>
          {session.Effort ? <span className="composer-chip">{"effort " + session.Effort}</span> : null}
          <span className="spacer" />
          <button type="submit" className="send" aria-label={busy(session) ? "Queue" : "Send"} disabled={blank || posting || locked}>
            ↑
          </button>
        </div>
      </form>
      <p className="hint" data-testid="composer-hint">
        {locked ? (
          <>
            Answer the permission above to continue · <kbd>Enter</kbd> queues
          </>
        ) : (
          <>
            <kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line{busy(session) ? " · the agent is busy, so a message waits in the queue" : ""}
          </>
        )}
      </p>
    </footer>
  );
}

function capital(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function agentChip(session: Session): string {
  return [session.Harness, session.Model].filter(Boolean).map((w) => capital(String(w))).join(" · ");
}

export function StartFreshButton({ onFresh }: { onFresh: () => Promise<string> }) {
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState("");
  async function fresh() {
    setWorking(true);
    setNote("");
    const failed = await onFresh();
    setWorking(false);
    if (failed) {
      setNote(failed);
    } else {
      setAsking(false);
    }
  }
  if (!asking) {
    return (
      <button type="button" className="qb fresh" aria-label="Start fresh" title="Start fresh" onClick={() => setAsking(true)}>
        <span className="i" aria-hidden="true">
          ↺
        </span>
        <span className="qb-label">Start fresh</span>
      </button>
    );
  }
  return (
    <span className="qb-confirm">
      <span className="qb-ask">Clear this conversation?</span>
      {note ? (
        <span className="qb-error" role="alert">
          {note}
        </span>
      ) : null}
      <button type="button" className="qb ghost" disabled={working} onClick={() => setAsking(false)}>
        Cancel
      </button>
      <button type="button" className="qb strong" disabled={working} onClick={() => void fresh()}>
        Start fresh
      </button>
    </span>
  );
}

function MateTools({ api, session, mate, snapshot }: { api: Authed; session: Session; mate: string; snapshot: StreamSnapshot }) {
  const { defs } = useMateDefs(api);
  const def = defs.find((d) => d.name === mate);
  const row = snapshot.state?.mates?.mates.find((m) => m.name === mate);
  const state = row ? faceState(row, []) : "idle";
  const shown = shownName(mate);

  async function fresh(): Promise<string> {
    try {
      const out = await startFresh(api, session.ID, true);
      window.location.hash = "#/sessions/" + encodeURIComponent(out.ID);
      return "";
    } catch (err) {
      return errorText(err);
    }
  }

  return (
    <>
      <a href={"#/mates/" + encodeURIComponent(mate)} className="mate-bar-who" aria-label={mate + ", " + stateWords[state]} title={"Profile of " + shown}>
        <MateFace name={mate} avatar={row?.avatar || def?.avatar} color={row?.color || def?.color} state={state} px={28} />
        <strong>{mate}</strong>
      </a>
      {session.Ended || busy(session) ? null : <StartFreshButton onFresh={fresh} />}
    </>
  );
}

export function SessionScreen({
  id,
  snapshot,
  now,
  onRetry,
  client,
  api,
  storage,
  onBrowser,
  inBar,
}: {
  id: string;
  onBrowser?: () => void;
  inBar?: boolean;
  snapshot: StreamSnapshot;
  now: number;
  onRetry: () => void;
  client: StreamClient;
  api: Authed;
  storage?: KeyValue;
}) {
  const session = snapshot.state?.sessions.find((s) => s.ID === id);
  const unread = session?.Unread ?? false;
  const { fetch, token } = api;
  useEffect(() => {
    if (unread) markRead({ fetch, token }, id).catch(() => {});
  }, [fetch, token, id, unread]);
  if (!session) {
    return (
      <main className="screen">
        <Back />
        <Connection snapshot={snapshot} now={now} onRetry={onRetry} />
        {snapshot.state ? (
          <section className="card empty">
            <p>This session is gone.</p>
          </section>
        ) : null}
      </main>
    );
  }
  const sends = (snapshot.state?.sends ?? []).filter((s) => s.session === id);
  const persona = personaOf(session, snapshot);
  return (
    <div className="chat-screen">
      <Header
        session={session}
        now={now}
        api={api}
        mate={session.Mate?.Name ? <MateTools api={api} session={session} mate={session.Mate.Name} snapshot={snapshot} /> : undefined}
        commands={storage ? <SessionCommands api={api} session={session} storage={storage} button /> : undefined}
        inBar={inBar}
      />
      <Connection snapshot={snapshot} now={now} onRetry={onRetry} />
      <main className="chat-main">
        <Chat id={id} client={client} api={api} status={snapshot.status} persona={persona} freshFrom={session.Mate?.FreshFrom || undefined} onBrowser={onBrowser}>
          <PermissionCard api={api} session={session} />
        </Chat>
      </main>
      <Composer session={session} api={api} sends={sends} persona={persona} />
    </div>
  );
}

export function ThreadChat({
  id,
  snapshot,
  client,
  api,
  placeholder,
  readOnly = false,
}: {
  id: string;
  snapshot: StreamSnapshot;
  client: StreamClient;
  api: Authed;
  placeholder: string;
  readOnly?: boolean;
}) {
  const session = snapshot.state?.sessions.find((s) => s.ID === id);
  if (!session) {
    return <p className="mt-note">{snapshot.state ? "This conversation is gone." : "Loading…"}</p>;
  }
  const sends = (snapshot.state?.sends ?? []).filter((s) => s.session === id);
  const persona = personaOf(session, snapshot);
  return (
    <div className="chat-screen mp-chat">
      <main className="chat-main">
        <Chat id={id} client={client} api={api} status={snapshot.status} persona={persona} freshFrom={session.Mate?.FreshFrom || undefined}>
          <PermissionCard api={api} session={session} />
        </Chat>
      </main>
      {!readOnly && <Composer session={session} api={api} sends={sends} persona={persona} placeholder={placeholder} />}
    </div>
  );
}
