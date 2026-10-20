import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { addReviewComment, applyHunk, markViewed, openReview, sendReview, type Authed } from "../api";
import {
  anchorNumber,
  canSend,
  commentAnchor,
  commentedLines,
  decodeDraft,
  decodeReview,
  draftRows,
  hunkOnly,
  LineAdded,
  LineDeleted,
  queueNotice,
  reviewScopes,
  reviewTree,
  segments,
  splitRows,
  visibleWorktrees,
  worktreeMenu,
  type DiffLine,
  type FileDiff,
  type Review,
  type ReviewWorktree,
  type Scope,
} from "../review";

type Layout = "unified" | "split";

type Key = { worktree: string; path: string };

type Composer = { key: Key; lines: DiffLine[]; text: string };

type Selected = { worktree: ReviewWorktree; file: FileDiff };

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function selectedFile(review: Review | null, worktree: string, key: Key | null): Selected | null {
  if (!review) {
    return null;
  }
  const shown = visibleWorktrees(review, worktree);
  if (key) {
    for (const w of shown) {
      if (w.Worktree.ID !== key.worktree) {
        continue;
      }
      const f = w.Files.find((x) => x.Path === key.path);
      if (f) {
        return { worktree: w.Worktree, file: f };
      }
    }
  }
  for (const w of shown) {
    if (w.Files.length > 0) {
      return { worktree: w.Worktree, file: w.Files[0] };
    }
  }
  return null;
}

function Code({ line }: { line: DiffLine }) {
  return (
    <code className="diff-code">
      {segments(line).map((s, i) =>
        s.cls ? (
          <span key={i} className={"tok-" + s.cls}>
            {s.text}
          </span>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        ),
      )}
    </code>
  );
}

const sign = (l: DiffLine) => (l.Kind === LineAdded ? "+" : l.Kind === LineDeleted ? "−" : " ");
const tone = (l: DiffLine | null) => (!l ? "line-empty" : l.Kind === LineAdded ? "line-added" : l.Kind === LineDeleted ? "line-deleted" : "line-context");

function CommentButton({ line, onPick }: { line: DiffLine; onPick: (line: DiffLine, extend: boolean) => void }) {
  const n = anchorNumber(line);
  const label = (line.Kind === LineDeleted ? "Comment on removed line " : "Comment on line ") + n;
  return (
    <button type="button" className="line-comment" aria-label={label} onClick={(e: MouseEvent) => onPick(line, e.shiftKey)}>
      +
    </button>
  );
}

function HunkHeader({ header, onStage, onRevert, busy }: { header: string; onStage: () => void; onRevert: () => void; busy: boolean }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="hunk-head">
      <code>{header}</code>
      <span className="hunk-actions">
        {confirming ? (
          <>
            <span className="muted">The change is removed from the working tree. You cannot undo this from crew.</span>
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                onRevert();
              }}
            >
              Revert
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={busy} onClick={onStage}>
              Stage hunk
            </button>
            <button type="button" className="danger" disabled={busy} onClick={() => setConfirming(true)}>
              Revert…
            </button>
          </>
        )}
      </span>
    </div>
  );
}

function ComposerRow({ composer, colSpan, onText, onCancel, onSubmit }: { composer: Composer; colSpan: number; onText: (t: string) => void; onCancel: () => void; onSubmit: () => void }) {
  const anchor = commentAnchor(composer.lines);
  const range = anchor ? (anchor.start === anchor.end ? String(anchor.start) : anchor.start + "-" + anchor.end) : "";
  return (
    <tr className="composer-row">
      <td colSpan={colSpan}>
        <div className="review-composer">
          <label>
            <span className="muted">
              {composer.key.path}:{range}
            </span>
            <textarea aria-label="Comment" autoFocus value={composer.text} onChange={(e) => onText(e.target.value)} rows={3} />
          </label>
          <div className="review-composer-actions">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="primary" disabled={composer.text.trim() === ""} onClick={onSubmit}>
              Comment
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

type DiffProps = {
  selected: Selected;
  layout: Layout;
  commented: (l: DiffLine) => boolean;
  composer: Composer | null;
  onPick: (line: DiffLine, extend: boolean) => void;
  onComposerText: (t: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  onHunk: (index: number, action: "stage" | "revert") => void;
  hunkError: { index: number; message: string } | null;
  busy: boolean;
  viewed: boolean;
  onViewed: (v: boolean) => void;
};

function DiffView(p: DiffProps) {
  const { file } = p.selected;
  const forThis = p.composer && p.composer.key.worktree === p.selected.worktree.ID && p.composer.key.path === file.Path ? p.composer : null;
  const last = forThis ? forThis.lines[forThis.lines.length - 1] : null;
  const cols = 4;
  const composerAfter = (l: DiffLine | null) =>
    forThis && l && l === last ? <ComposerRow composer={forThis} colSpan={cols} onText={p.onComposerText} onCancel={p.onCancel} onSubmit={p.onSubmit} /> : null;
  const picked = (l: DiffLine | null) => !!forThis && !!l && forThis.lines.includes(l);
  const rowClass = (l: DiffLine | null) => tone(l) + (l && p.commented(l) ? " commented" : "") + (picked(l) ? " picked" : "");
  return (
    <section className="review-diff" aria-label={file.Path}>
      <header className="diff-file-head">
        <span className="diff-path">{file.OldPath && file.OldPath !== file.Path ? file.OldPath + " → " + file.Path : file.Path}</span>
        <label className="viewed-toggle">
          <input type="checkbox" checked={p.viewed} onChange={(e) => p.onViewed(e.target.checked)} />
          Viewed
        </label>
      </header>
      {file.Binary ? <p className="muted diff-note">Binary file</p> : null}
      {!file.Binary && file.Hunks.length === 0 ? <p className="muted diff-note">No text changes</p> : null}
      {file.Hunks.length > 0 ? (
        <table className={"diff-table diff-" + p.layout}>
          {file.Hunks.map((h, hi) => (
            <tbody key={hi}>
              <tr className="hunk-row">
                <td colSpan={cols}>
                  <HunkHeader header={h.Header} busy={p.busy} onStage={() => p.onHunk(hi, "stage")} onRevert={() => p.onHunk(hi, "revert")} />
                  {p.hunkError && p.hunkError.index === hi ? (
                    <p className="hunk-error" role="alert">
                      {p.hunkError.message}
                    </p>
                  ) : null}
                </td>
              </tr>
              {p.layout === "unified"
                ? h.Lines.map((l, li) => (
                    <Fragment key={li}>
                      <tr className={rowClass(l)}>
                        <td className="ln">{l.Old > 0 && l.Kind !== LineAdded ? l.Old : ""}</td>
                        <td className="ln">
                          {l.New > 0 && l.Kind !== LineDeleted ? l.New : ""}
                          <CommentButton line={l} onPick={p.onPick} />
                        </td>
                        <td className="sign">{sign(l)}</td>
                        <td className="code">
                          <Code line={l} />
                        </td>
                      </tr>
                      {composerAfter(l)}
                    </Fragment>
                  ))
                : splitRows(h).map((r, ri) => (
                    <Fragment key={ri}>
                      <tr className={rowClass(r.right ?? r.left)}>
                        <td className={"ln " + tone(r.left)}>
                          {r.left ? r.left.Old : ""}
                          {r.left && r.left.Kind === LineDeleted ? <CommentButton line={r.left} onPick={p.onPick} /> : null}
                        </td>
                        <td className={"code " + tone(r.left)}>{r.left ? <Code line={r.left} /> : null}</td>
                        <td className={"ln " + tone(r.right)}>
                          {r.right ? r.right.New : ""}
                          {r.right ? <CommentButton line={r.right} onPick={p.onPick} /> : null}
                        </td>
                        <td className={"code " + tone(r.right)}>{r.right ? <Code line={r.right} /> : null}</td>
                      </tr>
                      {composerAfter(r.right) ?? composerAfter(r.left)}
                    </Fragment>
                  ))}
            </tbody>
          ))}
        </table>
      ) : null}
    </section>
  );
}

export type ReviewPaneProps = { session: string; sessionState: string; api: Authed; initial?: Review };

export function ReviewPane({ session, sessionState, api, initial }: ReviewPaneProps) {
  const [scope, setScope] = useState<Scope | "">(initial?.scope ?? "");
  const [worktree, setWorktree] = useState("");
  const [layout, setLayout] = useState<Layout>("unified");
  const [review, setReview] = useState<Review | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState<Key | null>(null);
  const [composer, setComposer] = useState<Composer | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [hunkError, setHunkError] = useState<{ index: number; message: string } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const skipFirst = useRef(initial !== undefined);
  const generation = useRef(0);

  const load = useCallback(
    async (s: Scope | "", w: string) => {
      const mine = ++generation.current;
      try {
        const out = decodeReview(await openReview(api, session, s, w));
        if (mine !== generation.current) {
          return;
        }
        setReview(out);
        setScope(out.scope);
        setError(null);
      } catch (err) {
        if (mine === generation.current) {
          setError(errorText(err));
        }
      }
    },
    [api, session],
  );

  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    void load("", "");
  }, [load]);

  const choose = (s: Scope | "", w: string) => {
    setScope(s);
    setWorktree(w);
    setHunkError(null);
    void load(s, w);
  };

  const tree = useMemo(() => (review ? reviewTree(review, worktree) : []), [review, worktree]);
  const selected = selectedFile(review, worktree, key);
  const draft = review?.draft ?? null;
  const rows = draftRows(review, draft);
  const commented = useMemo(() => (selected ? commentedLines(draft, selected.worktree, selected.file.Path) : () => false), [draft, selected]);
  const fileCount = tree.reduce((n, g) => n + g.files.length, 0);

  const setViewed = (worktreeId: string, path: string, blob: string, viewed: boolean) => {
    setReview((r) => {
      if (!r) {
        return r;
      }
      const rest = r.viewed.filter((m) => !(m.Worktree === worktreeId && m.Path === path));
      return { ...r, viewed: viewed ? [...rest, { Worktree: worktreeId, Path: path, Blob: blob }] : rest };
    });
    markViewed(api, session, { Worktree: worktreeId, Path: path, Blob: blob }, viewed).catch((err) => setError(errorText(err)));
  };

  const pick = (line: DiffLine, extend: boolean) => {
    if (!selected) {
      return;
    }
    const k = { worktree: selected.worktree.ID, path: selected.file.Path };
    const all = selected.file.Hunks.flatMap((h) => h.Lines);
    if (extend && composer && composer.key.worktree === k.worktree && composer.key.path === k.path) {
      const from = all.indexOf(composer.lines[0]);
      const to = all.indexOf(composer.lines[composer.lines.length - 1]);
      const at = all.indexOf(line);
      if (from >= 0 && to >= 0 && at >= 0) {
        setComposer({ ...composer, lines: all.slice(Math.min(from, at), Math.max(to, at) + 1) });
        return;
      }
    }
    setKey(k);
    setComposer({ key: k, lines: [line], text: composer?.text ?? "" });
  };

  const submit = async () => {
    if (!composer) {
      return;
    }
    const anchor = commentAnchor(composer.lines);
    if (!anchor) {
      return;
    }
    try {
      const out = decodeDraft(
        await addReviewComment(api, session, {
          worktree: composer.key.worktree,
          path: composer.key.path,
          start_line: anchor.start,
          end_line: anchor.end,
          code: anchor.code.join("\n"),
          body: composer.text,
          removed: anchor.removed,
        }),
      );
      setReview((r) => (r ? { ...r, draft: out } : r));
      setComposer(null);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const hunk = async (index: number, action: "stage" | "revert") => {
    if (!selected) {
      return;
    }
    setBusy(true);
    setHunkError(null);
    try {
      await applyHunk(api, session, { worktree: selected.worktree.ID, file: hunkOnly(selected.file, index), hunk: 0, action });
      await load("", worktree);
    } catch (err) {
      setHunkError({ index, message: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    setSendError(null);
    try {
      const out = decodeDraft(await sendReview(api, session, note));
      setReview((r) => (r ? { ...r, draft: out } : r));
      setNote("");
    } catch (err) {
      setSendError(errorText(err));
    }
  };

  const notice = queueNotice(sessionState);
  const status = draft?.status && draft.status !== "open" ? draft.status[0].toUpperCase() + draft.status.slice(1) : null;

  return (
    <div className="review-pane">
      <div className="review-bar">
        <div className="segmented" role="radiogroup" aria-label="Scope">
          {reviewScopes.map((s) => (
            <label key={s.id} className={scope === s.id ? "on" : undefined}>
              <input type="radio" name={"scope-" + session} checked={scope === s.id} onChange={() => choose(s.id, worktree)} />
              {s.title}
            </label>
          ))}
        </div>
        <label className="review-worktree">
          <span className="visually-hidden">Worktree</span>
          <select aria-label="Worktree" value={worktree} onChange={(e) => choose(scope, e.target.value)}>
            {(review ? worktreeMenu(review) : [{ id: "", title: "All" }]).map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">{fileCount === 1 ? "1 file" : fileCount + " files"}</span>
        <span className="spacer" />
        <div className="segmented" role="radiogroup" aria-label="Layout">
          {(["unified", "split"] as Layout[]).map((l) => (
            <label key={l} className={layout === l ? "on" : undefined}>
              <input type="radio" name={"layout-" + session} checked={layout === l} onChange={() => setLayout(l)} />
              {l === "unified" ? "Unified" : "Split"}
            </label>
          ))}
        </div>
        <button type="button" onClick={() => void load(scope, worktree)}>
          Reload
        </button>
      </div>
      {error ? (
        <p className="review-error" role="alert">
          {error}
        </p>
      ) : null}
      {review ? (
        <div className="review-body">
          <nav className="review-tree" aria-label="Changed files">
            {tree.map((g) => (
              <section key={g.id} className="tree-group">
                <h3>{g.title}</h3>
                {g.error ? <p className="tree-error">{g.error}</p> : null}
                {g.files.length === 0 && !g.error ? <p className="muted">No changes</p> : null}
                <ul>
                  {g.files.map((f) => {
                    const current = selected?.worktree.ID === f.worktree && selected.file.Path === f.path;
                    return (
                      <li key={f.path} className={current ? "current" : undefined}>
                        <input type="checkbox" aria-label={"Viewed " + f.path} checked={f.viewed} onChange={(e) => setViewed(f.worktree, f.path, f.blob, e.target.checked)} />
                        <button type="button" aria-current={current ? "true" : undefined} onClick={() => setKey({ worktree: f.worktree, path: f.path })}>
                          <span className={"file-status status-" + f.status}>{f.status}</span>
                          <span className="file-path">{f.path}</span>
                          <span className="file-added">+{f.added}</span>
                          <span className="file-deleted">−{f.deleted}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </nav>
          <div className="review-main">
            {selected ? (
              <DiffView
                key={selected.worktree.ID + "\u0000" + selected.file.Path}
                selected={selected}
                layout={layout}
                commented={commented}
                composer={composer}
                onPick={pick}
                onComposerText={(t) => setComposer((c) => (c ? { ...c, text: t } : c))}
                onCancel={() => setComposer(null)}
                onSubmit={() => void submit()}
                onHunk={(i, a) => void hunk(i, a)}
                hunkError={hunkError}
                busy={busy}
                viewed={tree.some((g) => g.files.some((f) => f.worktree === selected.worktree.ID && f.path === selected.file.Path && f.viewed))}
                onViewed={(v) => setViewed(selected.worktree.ID, selected.file.Path, selected.file.Blob, v)}
              />
            ) : (
              <div className="pane-placeholder">
                <p className="pane-title">No changes</p>
                <p className="muted">There is nothing to review in this scope.</p>
              </div>
            )}
          </div>
          <section className="draft-panel" aria-label="Draft review">
            <h3>
              Draft review <span className="count">{rows.length}</span>
            </h3>
            {status ? <p className="draft-status">{status}</p> : null}
            {rows.length === 0 ? <p className="muted">Click + next to a line number to comment. Shift-click to select a range.</p> : null}
            <ul>
              {rows.map((r) => (
                <li key={r.id}>
                  <span className="draft-label">{r.label}</span>
                  <span className="draft-body">{r.body}</span>
                </li>
              ))}
            </ul>
            <label className="draft-note">
              <span>Overall note</span>
              <textarea aria-label="Overall note" value={note} rows={3} onChange={(e) => setNote(e.target.value)} />
            </label>
            {notice && canSend(draft) ? <p className="muted">{notice}</p> : null}
            {sendError ? (
              <p className="review-error" role="alert">
                {sendError}
              </p>
            ) : null}
            <button type="button" className="primary" disabled={!canSend(draft)} onClick={() => void send()}>
              Send to agent
            </button>
          </section>
        </div>
      ) : null}
    </div>
  );
}
