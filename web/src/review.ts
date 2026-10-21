export type Span = [number, number, string];

export const LineContext = 32;
export const LineAdded = 43;
export const LineDeleted = 45;

export type DiffLine = { Kind: number; Old: number; New: number; Text: string; NoEOL?: boolean; Spans?: Span[] };

export type Hunk = { Header: string; Lines: DiffLine[] };

export type FileDiff = {
  Path: string;
  OldPath: string;
  Status: string;
  Added: number;
  Deleted: number;
  Binary: boolean;
  Blob: string;
  Mode?: string;
  Hunks: Hunk[];
};

export type ReviewWorktree = { ID: string; Repo: string; Path: string; Branch: string; PR: { Number: number } | null };

export type WorktreeReview = { Worktree: ReviewWorktree; From: string; Files: FileDiff[]; Err: string };

export type ViewedMark = { Worktree: string; Path: string; Blob: string };

export type ReviewComment = { id?: string; worktree: string; path: string; start: number; end: number; removed?: boolean; code: string[]; body: string };

export type ReviewDraft = { id: string; session: string; status: string; comments: ReviewComment[]; note?: string };

export type Scope = "last_turn" | "uncommitted" | "branch";

export type Review = { scope: Scope; worktrees: WorktreeReview[]; viewed: ViewedMark[]; draft: ReviewDraft | null };

export const reviewScopes: { id: Scope; title: string }[] = [
  { id: "last_turn", title: "Last turn" },
  { id: "uncommitted", title: "Uncommitted" },
  { id: "branch", title: "Branch" },
];

type Raw = Record<string, unknown>;

const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : 0);

function decodeLine(raw: Raw): DiffLine {
  const out: DiffLine = { Kind: num(raw.Kind), Old: num(raw.Old), New: num(raw.New), Text: str(raw.Text) };
  if (raw.NoEOL) {
    out.NoEOL = true;
  }
  if (Array.isArray(raw.Spans)) {
    out.Spans = raw.Spans as Span[];
  }
  return out;
}

function decodeFile(raw: Raw): FileDiff {
  return {
    Path: str(raw.Path),
    OldPath: str(raw.OldPath),
    Status: str(raw.Status),
    Added: num(raw.Added),
    Deleted: num(raw.Deleted),
    Binary: raw.Binary === true,
    Blob: str(raw.Blob),
    Mode: typeof raw.Mode === "string" ? raw.Mode : undefined,
    Hunks: list<Raw>(raw.Hunks).map((h) => ({ Header: str(h.Header), Lines: list<Raw>(h.Lines).map(decodeLine) })),
  };
}

function decodeWorktree(raw: Raw): ReviewWorktree {
  const pr = raw.PR as Raw | null | undefined;
  const id = str(raw.ID);
  return { ID: id, Repo: str(raw.Repo), Path: str(raw.Path) || id, Branch: str(raw.Branch), PR: pr && typeof pr.Number === "number" && pr.Number > 0 ? { Number: pr.Number } : null };
}

export function decodeDraft(raw: unknown): ReviewDraft | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const d = raw as Raw;
  if (!d.id && list(d.comments).length === 0) {
    return null;
  }
  return {
    id: str(d.id),
    session: str(d.session),
    status: str(d.status),
    note: str(d.note),
    comments: list<Raw>(d.comments).map((c) => ({
      id: typeof c.id === "string" ? c.id : undefined,
      worktree: str(c.worktree),
      path: str(c.path),
      start: num(c.start),
      end: num(c.end),
      removed: c.removed === true,
      code: list<string>(c.code),
      body: str(c.body),
    })),
  };
}

export function decodeReview(raw: unknown): Review {
  const r = (raw ?? {}) as Raw;
  return {
    scope: (str(r.scope) || "last_turn") as Scope,
    worktrees: list<Raw>(r.worktrees).map((w) => ({
      Worktree: decodeWorktree((w.Worktree ?? {}) as Raw),
      From: str(w.From),
      Files: list<Raw>(w.Files).map(decodeFile),
      Err: str(w.Err),
    })),
    viewed: list<ViewedMark>(r.viewed),
    draft: decodeDraft(r.draft),
  };
}

const base = (p: string): string => p.replace(/\/+$/, "").split("/").pop() ?? p;

export function worktreeTitle(w: ReviewWorktree): string {
  const name = base(w.Repo || w.Path);
  if (w.PR) {
    return name + " #" + w.PR.Number;
  }
  return w.Branch ? name + "@" + w.Branch : name;
}

export type TreeFile = { worktree: string; path: string; status: string; added: number; deleted: number; viewed: boolean; blob: string };

export type TreeGroup = { id: string; title: string; error: string; files: TreeFile[] };

export function visibleWorktrees(review: Review, worktree: string): WorktreeReview[] {
  return worktree ? review.worktrees.filter((w) => w.Worktree.ID === worktree) : review.worktrees;
}

export function isViewed(viewed: ViewedMark[], worktree: string, f: FileDiff): boolean {
  return viewed.some((m) => m.Worktree === worktree && m.Path === f.Path && m.Blob === f.Blob);
}

export function reviewTree(review: Review, worktree: string): TreeGroup[] {
  return visibleWorktrees(review, worktree).map((w) => ({
    id: w.Worktree.ID,
    title: worktreeTitle(w.Worktree),
    error: w.Err,
    files: w.Files.map((f) => ({
      worktree: w.Worktree.ID,
      path: f.Path,
      status: f.Status,
      added: f.Added,
      deleted: f.Deleted,
      blob: f.Blob,
      viewed: isViewed(review.viewed, w.Worktree.ID, f),
    })),
  }));
}

export function worktreeMenu(review: Review): { id: string; title: string }[] {
  return [{ id: "", title: "All" }, ...review.worktrees.map((w) => ({ id: w.Worktree.ID, title: worktreeTitle(w.Worktree) }))];
}

export type SplitRow = { left: DiffLine | null; right: DiffLine | null };

export function splitRows(h: Hunk): SplitRow[] {
  const rows: SplitRow[] = [];
  const lines = h.Lines;
  let i = 0;
  while (i < lines.length) {
    if (lines[i].Kind === LineContext) {
      rows.push({ left: lines[i], right: lines[i] });
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i].Kind === LineDeleted) {
      dels.push(lines[i++]);
    }
    while (i < lines.length && lines[i].Kind === LineAdded) {
      adds.push(lines[i++]);
    }
    if (dels.length === 0 && adds.length === 0) {
      rows.push({ left: lines[i], right: lines[i] });
      i++;
      continue;
    }
    for (let j = 0; j < Math.max(dels.length, adds.length); j++) {
      rows.push({ left: dels[j] ?? null, right: adds[j] ?? null });
    }
  }
  return rows;
}

export type Segment = { text: string; cls: string | null };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function segments(line: DiffLine): Segment[] {
  if (!line.Spans || line.Spans.length === 0) {
    return [{ text: line.Text, cls: null }];
  }
  const bytes = encoder.encode(line.Text);
  const text = (from: number, to: number) => decoder.decode(bytes.subarray(from, to));
  const out: Segment[] = [];
  let cursor = 0;
  for (const [start, end, cls] of line.Spans) {
    if (start < cursor || end > bytes.length || end <= start) {
      continue;
    }
    if (start > cursor) {
      out.push({ text: text(cursor, start), cls: null });
    }
    out.push({ text: text(start, end), cls });
    cursor = end;
  }
  if (cursor < bytes.length) {
    out.push({ text: text(cursor, bytes.length), cls: null });
  }
  return out;
}

export type Anchor = { start: number; end: number; removed: boolean; code: string[] };

export function anchorNumber(l: DiffLine): number {
  return l.Kind === LineDeleted ? l.Old : l.New;
}

export function commentAnchor(lines: DiffLine[]): Anchor | null {
  if (lines.length === 0) {
    return null;
  }
  const removed = lines.every((l) => l.Kind === LineDeleted);
  const numbers = lines.map((l) => (removed ? l.Old : l.New)).filter((n) => n > 0);
  if (numbers.length === 0) {
    return null;
  }
  return { start: Math.min(...numbers), end: Math.max(...numbers), removed, code: lines.map((l) => l.Text) };
}

export function commentedLines(draft: ReviewDraft | null, w: ReviewWorktree, path: string): (l: DiffLine) => boolean {
  const ranges = (draft?.comments ?? []).filter((c) => (c.worktree === w.Path || c.worktree === w.ID) && c.path === path);
  return (l) =>
    ranges.some((c) => {
      const n = c.removed ? (l.Kind === LineDeleted ? l.Old : 0) : l.Kind === LineDeleted ? 0 : l.New;
      return n >= c.start && n <= c.end && n > 0;
    });
}

export type DraftRow = { id: string; label: string; body: string };

export function draftRows(review: Review | null, draft: ReviewDraft | null): DraftRow[] {
  return (draft?.comments ?? []).map((c, i) => {
    const named = review?.worktrees.find((w) => w.Worktree.Path === c.worktree || w.Worktree.ID === c.worktree);
    const name = named ? base(named.Worktree.Repo || named.Worktree.Path) : base(c.worktree);
    const lines = c.start === c.end ? String(c.start) : c.start + "-" + c.end;
    return { id: c.id ?? String(i), label: name + " · " + c.path + ":" + lines, body: c.body };
  });
}

export function canSend(draft: ReviewDraft | null): boolean {
  if (!draft || draft.comments.length === 0) {
    return false;
  }
  return draft.status === "open" || draft.status === "";
}

export function hunkOnly(file: FileDiff, index: number): FileDiff {
  return { ...file, Hunks: file.Hunks.slice(index, index + 1) };
}

export function queueNotice(state: string): string | null {
  return state === "idle" || state === "done" || state === "waiting" ? null : "The session is busy. The review waits in a queue until the session stops.";
}
