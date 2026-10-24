import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { diskActions, diskCards, diskPorts, diskRecent, diskRows, diskTiles, pollDelay, sizeLabel, type DiskView } from "./disk";
import type { PullRequest, Session, Worktree } from "./stream";

const golden = (): DiskView => JSON.parse(readFileSync(new URL("../../internal/serve/testdata/" + "disk.json", import.meta.url), "utf8"));

const pr = (state: string, number = 7): PullRequest => ({ Number: number, Title: "t", URL: "u", Head: "h", State: state, Checks: "" });

const wt = (id: string, extra: Partial<Worktree> = {}): Worktree => ({ ID: id, Repo: "api", Path: "/w/" + id, Branch: id, PR: null, SubtaskSlug: "", SessionID: "", Ports: null, ...extra });

const sess = (id: string, name: string) => ({ ID: id, name }) as Session;

function view(rows: DiskView["rows"], extra: Partial<DiskView> = {}): DiskView {
  return { ...golden(), rows, ...extra };
}

describe("sizeLabel", () => {
  it("writes decimal units with one decimal under 10 and a dash for pending", () => {
    expect(sizeLabel(-1)).toBe("…");
    expect(sizeLabel(512)).toBe("512 B");
    expect(sizeLabel(1_240_000_000)).toBe("1.2 GB");
    expect(sizeLabel(3_000_000_000)).toBe("3 GB");
    expect(sizeLabel(61_400_000_000)).toBe("61 GB");
  });
});

describe("diskTiles", () => {
  it("shows the volume, the worktrees, what cleanup can free, the deps store and the schedule", () => {
    expect(diskTiles(golden())).toEqual({ free: "61 GB free", worktrees: "412 MB+", reclaimable: "…", depsStore: "3.1 GB", schedule: "every 10m" });
  });

  it("says off when there is no auto-cleanup and omits a missing deps store", () => {
    const t = diskTiles({ ...golden(), auto_clean_every: 0, deps_store: undefined, worktrees_pending: 0, reclaimable_pending: 0, reclaimable: 36_000_000 });
    expect(t.schedule).toBe("off");
    expect(t.depsStore).toBeNull();
    expect(t.worktrees).toBe("412 MB");
    expect(t.reclaimable).toBe("36 MB");
  });
});

describe("diskCards", () => {
  it("gives the five stat cards with the volume usage, the counts and the next cleanup", () => {
    expect(diskCards(golden(), "UTC")).toEqual([
      { title: "Volume", value: "61 GB free", sub: "88%", usage: 88 },
      { title: "Worktrees", value: "2", sub: "412 MB+", usage: null },
      { title: "Reclaimable", value: "…", sub: "1 worktree", usage: null },
      { title: "Shared deps store", value: "3.1 GB", sub: "pnpm", usage: null },
      { title: "Auto-cleanup", value: "On · every 10m", sub: "next at 14:30", usage: null },
    ]);
  });

  it("says Off with no auto-cleanup and leaves out a missing deps store", () => {
    const cards = diskCards({ ...golden(), auto_clean_every: 0, deps_store: undefined, next_cleanup: undefined }, "UTC");
    expect(cards.map((c) => c.title)).toEqual(["Volume", "Worktrees", "Reclaimable", "Auto-cleanup"]);
    expect(cards[3]).toEqual({ title: "Auto-cleanup", value: "Off", sub: "", usage: null });
  });
});

describe("diskRows", () => {
  it("gives each row its state and what cleanup does", () => {
    const v = view(
      [
        { WorktreeID: "open", Size: 1, Action: "keep", Reason: "not merged" },
        { WorktreeID: "clean", Size: 1, Action: "remove", Reason: "PR #7 merged" },
        { WorktreeID: "dirty", Size: 1, Action: "backup_then_ask", Reason: "3 uncommitted changes" },
        { WorktreeID: "loose", Size: 1, Action: "backup_then_ask", Reason: "detached" },
        { WorktreeID: "nopr", Size: 1, Action: "keep", Reason: "its session is live" },
        { WorktreeID: "head", Size: 1, Action: "keep", Reason: "in use by node" },
      ],
      { next_cleanup: "2026-10-20T14:30:00Z" },
    );
    const state = {
      worktrees: [wt("open", { PR: pr("OPEN") }), wt("clean"), wt("dirty"), wt("loose", { Branch: "" }), wt("nopr"), wt("head", { Branch: "" })],
      sessions: [],
    };
    const rows = diskRows(v, state, "UTC");
    expect(rows.map((r) => [r.status, r.plan])).toEqual([
      ["Open", "kept: not merged"],
      ["Merged · clean", "removes at 14:30"],
      ["Merged · dirty", "back up then ask"],
      ["Detached", "backup branch first"],
      ["No PR", "kept: its session is live"],
      ["Detached", "kept: in use by node"],
    ]);
  });

  it("names the worktree, its session, its PR and its ports", () => {
    const v = view([{ WorktreeID: "w1", Size: 412_000_000, Action: "keep", Reason: "its session is live" }], { next_cleanup: undefined });
    const state = { worktrees: [wt("w1", { Path: "/w/api-feat", SessionID: "s1", PR: pr("OPEN", 42) })], sessions: [sess("s1", "fix the login")] };
    const [row] = diskRows(v, state, "UTC", [
      { port: 5173, pgid: 40, command: "node", worktree: "/w/api-feat", session: "s1" },
      { port: 5174, pgid: 40, command: "node", worktree: "/w/api-feat", session: "s1" },
    ]);
    expect(row).toMatchObject({ worktree: "api-feat", path: "/w/api-feat", session: "fix the login", sessionID: "s1", pr: "#42", size: "412 MB", ports: ":5173 :5174", pgids: [40] });
  });

  it("gives a short plan label and keeps the full reason as detail", () => {
    const long = "facts unavailable: git status in /home/me/.local/state/loops/work-patrol-20261022T090837Z/681: exit status 128";
    const v = view(
      [
        { WorktreeID: "gone", Size: -2, Action: "prune", Reason: "folder is gone" },
        { WorktreeID: "moved", Size: 1, Action: "keep", Reason: "repo moved or missing" },
        { WorktreeID: "busy", Size: 1, Action: "keep", Reason: "in use by claude (pid 1337717)" },
        { WorktreeID: "odd", Size: 1, Action: "keep", Reason: long },
      ],
      { next_cleanup: undefined },
    );
    const rows = diskRows(v, { worktrees: [wt("gone"), wt("moved"), wt("busy"), wt("odd")], sessions: [] }, "UTC");
    expect(rows.map((r) => [r.status, r.plan, r.detail])).toEqual([
      ["Folder gone", "prunes in the next cleanup", "folder is gone"],
      ["No PR", "kept: repo moved or missing", "repo moved or missing"],
      ["No PR", "kept: in use by claude (pid 1337717)", "in use by claude (pid 1337717)"],
      ["No PR", "kept: git check failed", long],
    ]);
  });

  it("says the next cleanup when it has no time", () => {
    const [row] = diskRows(view([{ WorktreeID: "w1", Size: 1, Action: "remove", Reason: "merged" }], { next_cleanup: undefined }), { worktrees: [wt("w1")], sessions: [] }, "UTC");
    expect(row.plan).toBe("removes in the next cleanup");
  });
});

describe("diskActions", () => {
  const base = { id: "w", path: "/w/api-feat", worktree: "api-feat", sessionID: "s1", session: "fix", pr: "", status: "", tone: "", size: "", ports: "", pgids: [] as number[], plan: "", detail: "" };

  it("offers Prune for a row whose folder is gone, with a confirmation", () => {
    const acts = diskActions({ ...base, sessionID: "", action: "prune" });
    expect(acts.map((a) => a.title)).toEqual(["Prune…"]);
    expect(acts[0].confirm).toBe("Prune api-feat? Its folder is gone. crew runs git worktree prune; the branch stays.");
    expect(acts[0].cleanup).toEqual({ path: "/w/api-feat", backup: false });
  });

  it("offers no removal for a keep row", () => {
    expect(diskActions({ ...base, action: "keep" }).map((a) => a.kind)).toEqual(["session", "shell"]);
  });

  it("offers only Back up and remove for a backup_then_ask row, with a confirmation", () => {
    const acts = diskActions({ ...base, action: "backup_then_ask" });
    expect(acts.map((a) => a.title)).toEqual(["Go to session", "Open shell", "Back up and remove…"]);
    const last = acts[2];
    expect(last.confirm).toBe("Back up api-feat and remove it? The backup goes to the crew backups folder.");
    expect(last.cleanup).toEqual({ path: "/w/api-feat", backup: true });
  });

  it("asks before Remove and before it kills dev servers", () => {
    const acts = diskActions({ ...base, sessionID: "", action: "remove", ports: ":5173", pgids: [40] });
    expect(acts.map((a) => a.title)).toEqual(["Kill dev servers", "Remove…"]);
    expect(acts[0].confirm).toBe("Stop the dev server on :5173 in api-feat?");
    expect(acts[0].pgids).toEqual([40]);
    expect(acts[1].confirm).toBe("Remove api-feat? It goes to the crew trash; the branch stays.");
    expect(acts[1].cleanup).toEqual({ path: "/w/api-feat", backup: false });
    expect(acts.every((a) => a.confirm !== null)).toBe(true);
  });
});

describe("diskPorts and diskRecent", () => {
  it("sorts the ports and names their worktree and session", () => {
    const rows = diskPorts(
      [
        { port: 8080, pgid: 9, command: "go", worktree: "/w/web-x", session: "" },
        { port: 5173, pgid: 40, command: "node", worktree: "/w/api-feat", session: "s1" },
      ],
      [sess("s1", "fix")],
    );
    expect(rows.map((r) => [r.port, r.worktree, r.session])).toEqual([
      [5173, "api-feat", "fix"],
      [8080, "web-x", ""],
    ]);
  });

  it("tells how long ago each cleanup ran", () => {
    expect(diskRecent(golden(), Date.parse("2026-10-20T14:30:00Z"))).toEqual([{ key: "2026-10-20T13:30:00Z/w/api-old", worktree: "api-old", branch: "old", when: "1h 0m ago", outcome: "removed" }]);
  });
});

describe("pollDelay", () => {
  it("polls every 2 s while sizes are pending, else every 10 s", () => {
    expect(pollDelay(null)).toBe(2000);
    expect(pollDelay(golden())).toBe(2000);
    expect(pollDelay({ ...golden(), worktrees_pending: 0, reclaimable_pending: 0, deps_store: { path: "/p", size: -1 } })).toBe(2000);
    expect(pollDelay({ ...golden(), worktrees_pending: 0, reclaimable_pending: 0 })).toBe(10000);
  });
});
