import { readFileSync } from "node:fs";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { decodeReview } from "../review";
import { desktop } from "../test/desktop";
import { FakeServer } from "../test/fake-server";
import { ReviewPane } from "./Review";
import { pick } from "../test/pick";

const golden = (name: string): Record<string, unknown> => JSON.parse(readFileSync(new URL("../../../internal/serve/testdata/" + name, import.meta.url), "utf8"));

const reviewPath = "/api/v1/sessions/s1/review";

function withSecondWorktree() {
  const body = golden("review-open.json") as { worktrees: unknown[] };
  body.worktrees.push({
    Worktree: { ID: "w2", Repo: "/home/me/web", Path: "/home/me/web-42", Branch: "42-fix", PR: null },
    From: "def456",
    Files: [
      {
        Path: "app.ts",
        OldPath: "",
        Status: "A",
        Added: 1,
        Deleted: 0,
        Binary: false,
        Blob: "c3",
        Hunks: [{ Header: "@@ -0,0 +1 @@", Lines: [{ Kind: 43, Old: 0, New: 1, Text: "export const a = 1;", Spans: [[0, 6, "keyword"]] }] }],
      },
    ],
    Err: "",
  });
  return body;
}

async function openReview(extra: (s: ReturnType<typeof desktop>["server"]) => void = () => undefined) {
  const d = desktop("#/sessions/s1");
  d.server.on("GET", reviewPath, { status: 200, body: withSecondWorktree() });
  d.server.on("GET", reviewPath + "?scope=uncommitted", { status: 200, body: { ...withSecondWorktree(), scope: "uncommitted" } });
  d.server.on("GET", reviewPath + "?scope=branch&worktree=w2", { status: 200, body: withSecondWorktree() });
  extra(d.server);
  d.live();
  await userEvent.click(await screen.findByRole("tab", { name: "Changes" }));
  const pane = screen.getByRole("tabpanel", { name: "Changes" });
  await within(pane).findByRole("navigation", { name: "Changed files" });
  return { ...d, pane };
}

describe("the Review tab", () => {
  it("shows the file tree grouped by worktree with its PR", async () => {
    const { pane } = await openReview();
    const tree = within(pane).getByRole("navigation", { name: "Changed files" });
    expect(within(tree).getAllByRole("heading").map((h) => h.textContent)).toEqual(["api #42", "web@42-fix"]);
    expect(within(tree).getByRole("button", { name: /main\.go/ })).toHaveTextContent("+1");
    expect(within(pane).getByText("2 files")).toBeInTheDocument();
  });

  it("opens the scope that the session had and changes scope", async () => {
    const { pane, server } = await openReview();
    expect(within(pane).getByRole("radio", { name: "Branch" })).toBeChecked();
    await userEvent.click(within(pane).getByRole("radio", { name: "Uncommitted" }));
    expect(await within(pane).findByRole("radio", { name: "Uncommitted" })).toBeChecked();
    expect(server.calls.map((c) => c.path)).toContain(reviewPath + "?scope=uncommitted");
  });

  it("shows one worktree from the worktree menu", async () => {
    const { pane, server } = await openReview();
    await pick(userEvent.setup(), within(pane).getByRole("combobox", { name: "Worktree" }), "web@42-fix");
    const tree = within(pane).getByRole("navigation", { name: "Changed files" });
    expect(within(tree).getAllByRole("heading").map((h) => h.textContent)).toEqual(["web@42-fix"]);
    expect(server.calls.map((c) => c.path)).toContain(reviewPath + "?scope=branch&worktree=w2");
  });

  it("shows the unified diff with syntax spans, and a split diff", async () => {
    const { pane } = await openReview();
    const diff = within(pane).getByRole("region", { name: "main.go" });
    const keyword = within(diff).getAllByText("package")[0];
    expect(keyword).toHaveClass("tok-keyword");
    expect(within(diff).getAllByRole("row")).toHaveLength(4);
    await userEvent.click(within(pane).getByRole("radio", { name: "Split" }));
    expect(within(diff).getAllByRole("row")).toHaveLength(3);
    expect(within(diff).getByText("old")).toBeInTheDocument();
    expect(within(diff).getByText("run")).toBeInTheDocument();
  });

  it("ticks a viewed file and posts the mark", async () => {
    const { pane, server } = await openReview((s) => s.on("POST", reviewPath + "/viewed", { status: 200, body: {} }));
    const tree = within(pane).getByRole("navigation", { name: "Changed files" });
    expect(within(tree).getByRole("checkbox", { name: "Viewed main.go" })).toBeChecked();
    const app = within(tree).getByRole("checkbox", { name: "Viewed app.ts" });
    expect(app).not.toBeChecked();
    await userEvent.click(app);
    expect(app).toBeChecked();
    expect(server.calls.find((c) => c.path === reviewPath + "/viewed")?.body).toEqual({ mark: { Worktree: "w2", Path: "app.ts", Blob: "c3" }, viewed: true });
  });

  it("marks the lines of a comment range", async () => {
    const { pane } = await openReview();
    const diff = within(pane).getByRole("region", { name: "main.go" });
    const rows = within(diff).getAllByRole("row");
    expect(rows.map((r) => r.classList.contains("commented"))).toEqual([false, false, false, true]);
  });

  it("lists the draft comments as repo · path:lines and comments on a line range", async () => {
    const draft = golden("review-comment.json") as { comments: unknown[] };
    const more = { ...draft, comments: [...draft.comments, { id: "c2", worktree: "/home/me/api-42", path: "main.go", start: 1, end: 2, code: [], body: "shorter" }] };
    const { pane, server } = await openReview((s) => s.on("POST", reviewPath + "/comments", { status: 200, body: more }));
    const panel = within(pane).getByRole("region", { name: "Draft review" });
    expect(within(panel).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["api · main.go:2name it start"]);
    const diff = within(pane).getByRole("region", { name: "main.go" });
    await userEvent.click(within(diff).getByRole("button", { name: "Comment on line 1" }));
    fireEvent.click(within(diff).getByRole("button", { name: "Comment on line 2" }), { shiftKey: true });
    await userEvent.type(within(pane).getByRole("textbox", { name: "Comment" }), "shorter");
    await userEvent.click(within(pane).getByRole("button", { name: "Comment" }));
    expect(server.calls.find((c) => c.path === reviewPath + "/comments")?.body).toEqual({
      worktree: "w1",
      path: "main.go",
      start_line: 1,
      end_line: 2,
      code: "package main\nfunc old() {}\nfunc run() int { return 1 }",
      body: "shorter",
      removed: false,
    });
    expect(await within(panel).findByText("api · main.go:1-2")).toBeInTheDocument();
  });

  it("sends the draft to the agent with the overall note", async () => {
    const sent = { ...golden("review-send.json") };
    const { pane, server } = await openReview((s) => s.on("POST", reviewPath + "/send", { status: 200, body: sent }));
    const panel = within(pane).getByRole("region", { name: "Draft review" });
    await userEvent.type(within(panel).getByRole("textbox", { name: "Overall note" }), "looks good");
    await userEvent.click(within(panel).getByRole("button", { name: "Send to agent" }));
    expect(server.calls.find((c) => c.path === reviewPath + "/send")?.body).toEqual({ note: "looks good" });
    expect(await within(panel).findByText("Queued")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Send to agent" })).toBeDisabled();
  });

  it("stages a hunk with only that hunk in the request, then opens the review again", async () => {
    const { pane, server } = await openReview((s) => s.on("POST", reviewPath + "/hunk", { status: 200, body: {} }));
    const before = server.calls.filter((c) => c.path === reviewPath).length;
    await userEvent.click(within(pane).getByRole("button", { name: "Stage hunk" }));
    const call = server.calls.find((c) => c.path === reviewPath + "/hunk");
    expect(call?.body).toMatchObject({ worktree: "w1", hunk: 0, action: "stage", file: { Path: "main.go" } });
    await screen.findAllByRole("button", { name: "Stage hunk" });
    expect(server.calls.filter((c) => c.path === reviewPath).length).toBe(before + 1);
  });

  it("shows the message of the patch tool when git refuses a hunk, and keeps the review", async () => {
    const refused = golden("review-hunk-refused.json");
    const { pane, server } = await openReview((s) => s.on("POST", reviewPath + "/hunk", { status: 500, body: refused }));
    const before = server.calls.filter((c) => c.path === reviewPath).length;
    await userEvent.click(within(pane).getByRole("button", { name: "Revert…" }));
    await userEvent.click(within(pane).getByRole("button", { name: "Revert" }));
    expect(await within(pane).findByRole("alert")).toHaveTextContent("error: patch failed: main.go:1");
    expect(server.calls.filter((c) => c.path === reviewPath).length).toBe(before);
    expect(within(pane).getByRole("region", { name: "main.go" })).toBeInTheDocument();
  });

  it("shows the error when the review cannot open", async () => {
    const d = desktop("#/sessions/s1");
    d.server.on("GET", reviewPath, { status: 404, body: { error: { code: "not_found", message: "no session s1" } } });
    d.live();
    await userEvent.click(await screen.findByRole("tab", { name: "Changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no session s1");
  });
});

function bigReview(files: number) {
  const lines = Array.from({ length: 40 }, (_, i) => ({ Kind: i % 3 === 0 ? 43 : 32, Old: i + 1, New: i + 1, Text: "const value" + i + " = compute(" + i + ");", Spans: [[0, 5, "keyword"], [6, 12, "function"]] }));
  return {
    scope: "branch",
    worktrees: [
      {
        Worktree: { ID: "w1", Repo: "/home/me/api", Path: "/home/me/api-42", Branch: "42-fix", PR: { Number: 42 } },
        From: "abc",
        Err: "",
        Files: Array.from({ length: files }, (_, i) => ({ Path: "src/file" + i + ".ts", OldPath: "", Status: "M", Added: 14, Deleted: 0, Binary: false, Blob: "b" + i, Hunks: [{ Header: "@@ -1,40 +1,40 @@", Lines: lines }] })),
      },
    ],
    viewed: [],
    draft: { id: "", session: "s1", status: "", comments: [], turns: null },
  };
}

describe("a big review", () => {
  it("decodes and renders 50 files in under 300 ms", async () => {
    const raw = JSON.stringify(bigReview(50));
    const server = new FakeServer();
    const start = performance.now();
    const review = decodeReview(JSON.parse(raw));
    render(<ReviewPane session="s1" sessionState="idle" api={{ fetch: server.fetch, token: "t0k" }} initial={review} />);
    const elapsed = performance.now() - start;
    expect(within(screen.getByRole("navigation", { name: "Changed files" })).getAllByRole("button", { name: /src\/file/ })).toHaveLength(50);
    expect(elapsed).toBeLessThan(300);
  });
});
