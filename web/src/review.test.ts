import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canSend,
  commentAnchor,
  commentedLines,
  decodeReview,
  draftRows,
  hunkOnly,
  reviewScopes,
  reviewTree,
  segments,
  splitRows,
  worktreeMenu,
  worktreeTitle,
  type DiffLine,
  type Review,
} from "./review";

const golden = (name: string): unknown => JSON.parse(readFileSync(new URL("../../internal/serve/testdata/" + name, import.meta.url), "utf8"));

const line = (Kind: number, Old: number, New: number, Text: string): DiffLine => ({ Kind, Old, New, Text });

function twoWorktrees(): Review {
  const review = decodeReview(golden("review-open.json"));
  review.worktrees.push({
    Worktree: { ID: "w2", Repo: "/home/me/web", Path: "/home/me/web-42", Branch: "42-fix", PR: null },
    From: "def456",
    Files: [{ Path: "app.ts", OldPath: "", Status: "A", Added: 3, Deleted: 0, Binary: false, Blob: "c3", Hunks: [] }],
    Err: "",
  });
  return review;
}

describe("decodeReview", () => {
  it("reads the review.open golden of serve with its spans", () => {
    const review = decodeReview(golden("review-open.json"));
    expect(review.scope).toBe("branch");
    const lines = review.worktrees[0].Files[0].Hunks[0].Lines;
    expect(lines[0].Spans).toEqual([[0, 7, "keyword"]]);
    expect(review.draft?.comments).toHaveLength(1);
  });

  it("gives empty lists for the nulls of Go", () => {
    const review = decodeReview({ scope: "last_turn", worktrees: [{ Worktree: { ID: "w1" }, Files: null, Err: "" }], viewed: null, draft: { comments: null, status: "" } });
    expect(review.worktrees[0].Files).toEqual([]);
    expect(review.viewed).toEqual([]);
    expect(review.draft).toBeNull();
  });
});

describe("worktreeTitle", () => {
  it("names the repo with its PR, else with its branch", () => {
    const review = twoWorktrees();
    expect(worktreeTitle(review.worktrees[0].Worktree)).toBe("api #42");
    expect(worktreeTitle(review.worktrees[1].Worktree)).toBe("web@42-fix");
  });
});

describe("reviewTree", () => {
  it("groups the files by worktree and ticks the viewed files whose blob did not change", () => {
    const review = twoWorktrees();
    const tree = reviewTree(review, "");
    expect(tree.map((g) => g.title)).toEqual(["api #42", "web@42-fix"]);
    expect(tree[0].files[0]).toMatchObject({ path: "main.go", status: "M", added: 1, deleted: 1, viewed: true });
    expect(tree[1].files[0].viewed).toBe(false);
  });

  it("shows only the worktree chosen in the menu", () => {
    const review = twoWorktrees();
    expect(reviewTree(review, "w2").map((g) => g.id)).toEqual(["w2"]);
    expect(worktreeMenu(review)).toEqual([
      { id: "", title: "All" },
      { id: "w1", title: "api #42" },
      { id: "w2", title: "web@42-fix" },
    ]);
  });

  it("does not tick a file that changed since it was viewed", () => {
    const review = twoWorktrees();
    review.viewed = [{ Worktree: "w1", Path: "main.go", Blob: "old" }];
    expect(reviewTree(review, "")[0].files[0].viewed).toBe(false);
  });
});

describe("reviewScopes", () => {
  it("are last turn, uncommitted and branch", () => {
    expect(reviewScopes.map((s) => s.title)).toEqual(["Last turn", "Uncommitted", "Branch"]);
  });
});

describe("splitRows", () => {
  it("pairs removed lines with the added lines that follow them", () => {
    const rows = splitRows({
      Header: "@@",
      Lines: [line(32, 1, 1, "a"), line(45, 2, 0, "b"), line(45, 3, 0, "c"), line(43, 0, 2, "B"), line(32, 4, 3, "d")],
    });
    expect(rows.map((r) => [r.left?.Text ?? null, r.right?.Text ?? null])).toEqual([
      ["a", "a"],
      ["b", "B"],
      ["c", null],
      ["d", "d"],
    ]);
  });
});

describe("segments", () => {
  it("cuts the text at the byte offsets of the spans", () => {
    const l = { ...line(43, 0, 1, "s := \"é\" // x"), Spans: [[5, 9, "string"], [10, 14, "comment"]] as [number, number, string][] };
    expect(segments(l)).toEqual([
      { text: "s := ", cls: null },
      { text: '"é"', cls: "string" },
      { text: " ", cls: null },
      { text: "// x", cls: "comment" },
    ]);
  });

  it("gives the plain text when there are no spans", () => {
    expect(segments(line(32, 1, 1, "plain"))).toEqual([{ text: "plain", cls: null }]);
  });
});

describe("commentAnchor", () => {
  it("uses the new line numbers of a range with added or context lines", () => {
    expect(commentAnchor([line(45, 2, 0, "b"), line(43, 0, 2, "B"), line(43, 0, 3, "C")])).toEqual({ start: 2, end: 3, removed: false, code: ["b", "B", "C"] });
  });

  it("uses the old line numbers of a range of removed lines only", () => {
    expect(commentAnchor([line(45, 7, 0, "x"), line(45, 8, 0, "y")])).toEqual({ start: 7, end: 8, removed: true, code: ["x", "y"] });
  });
});

describe("draftRows", () => {
  it("lists each comment as repo · path:lines", () => {
    const review = decodeReview(golden("review-open.json"));
    review.draft!.comments.push({ id: "c2", worktree: "/home/me/api-42", path: "go.mod", start: 3, end: 5, code: [], body: "bump" });
    expect(draftRows(review, review.draft)).toEqual([
      { id: "c1", label: "api · main.go:2", body: "name it start" },
      { id: "c2", label: "api · go.mod:3-5", body: "bump" },
    ]);
  });
});

describe("commentedLines", () => {
  it("marks the lines in the range of a comment on the file", () => {
    const review = decodeReview(golden("review-open.json"));
    const marks = commentedLines(review.draft, review.worktrees[0].Worktree, "main.go");
    const lines = review.worktrees[0].Files[0].Hunks[0].Lines;
    expect(lines.map((l) => marks(l))).toEqual([false, false, true]);
  });
});

describe("canSend", () => {
  it("needs an open draft with comments", () => {
    const review = decodeReview(golden("review-open.json"));
    expect(canSend(review.draft)).toBe(true);
    expect(canSend({ ...review.draft!, status: "queued" })).toBe(false);
    expect(canSend({ ...review.draft!, comments: [] })).toBe(false);
    expect(canSend(null)).toBe(false);
  });
});

describe("hunkOnly", () => {
  it("keeps only the chosen hunk so the request stays small", () => {
    const review = decodeReview(golden("review-open.json"));
    const file = { ...review.worktrees[0].Files[0], Hunks: [{ Header: "@@ 1", Lines: [] }, { Header: "@@ 2", Lines: [] }] };
    expect(hunkOnly(file, 1).Hunks).toEqual([{ Header: "@@ 2", Lines: [] }]);
  });
});
