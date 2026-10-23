import { describe, expect, it } from "vitest";
import type { Approval } from "./api";
import { mateCard } from "./faces";
import { agoLabel, homeCards, homeSummary, recentActivity } from "./mateshome";
import type { MateRow } from "./stream";

const now = Date.parse("2026-10-03T12:00:00Z");

function row(name: string, extra: Partial<MateRow> = {}): MateRow {
  return { name, state: "connected", work: [], threads: [], conversations: [], ...extra };
}

const def = (name: string, agent: string) => ({ name, prompt: name + " role.\n\nMore.", agent, enabled: true });

const ask: Approval = {
  ID: "ap1",
  SessionID: "s9",
  Mate: "rex",
  Requester: "U1",
  Action: { Kind: "push", Tool: "Bash", Input: "git push --tags" },
  At: "2026-10-03T11:56:00Z",
  State: "pending",
};

const cards = () => [
  mateCard(row("ada", { conversations: [{ session: "s1", name: "review 42", state: "running", ended: false, started_at: "2026-10-03T12:00:00Z" }] }), def("ada", "claude"), []),
  mateCard(row("june", { state: "paused" }), def("june", "pi"), []),
  mateCard(row("rex"), def("rex", "codex"), ["rex"]),
];

describe("homeCards", () => {
  it("puts a mate that needs you first, with its approval, an Asks line and a link to the session", () => {
    const out = homeCards(cards(), [ask], "all", now);
    expect(out.map((c) => c.card.name)).toEqual(["rex", "ada", "june"]);
    expect(out[0]).toMatchObject({ pill: "needs you", tone: "warn", approval: ask, last: "Asks: git push --tags", when: "4m ago", open: "#/sessions/s9" });
    expect(out[1]).toMatchObject({ pill: "working", tone: "blue", last: "Working on review 42", when: "now" });
    expect(out[2]).toMatchObject({ pill: "paused", tone: "", approval: null, when: "" });
  });

  it("filters by harness, also Pi", () => {
    expect(homeCards(cards(), [], "pi", now).map((c) => c.card.name)).toEqual(["june"]);
    expect(homeCards(cards(), [], "codex", now).map((c) => c.card.name)).toEqual(["rex"]);
  });

  it("ignores decided approvals", () => {
    const out = homeCards(cards(), [{ ...ask, State: "granted" }], "all", now);
    expect(out.find((c) => c.card.name === "rex")?.approval).toBeNull();
  });
});

describe("homeSummary", () => {
  it("counts the mates and the working ones", () => {
    expect(homeSummary(cards())).toBe("3 mates · 1 working");
    expect(homeSummary(cards().slice(0, 1))).toBe("1 mate · 1 working");
  });
});

describe("agoLabel", () => {
  it("says now, minutes, hours, yesterday and days", () => {
    expect(agoLabel("2026-10-03T11:59:40Z", now)).toBe("now");
    expect(agoLabel("2026-10-03T11:56:00Z", now)).toBe("4m ago");
    expect(agoLabel("2026-10-03T03:00:00Z", now)).toBe("9h ago");
    expect(agoLabel("2026-10-02T06:00:00Z", now)).toBe("yesterday");
    expect(agoLabel("2026-09-29T12:00:00Z", now)).toBe("4d ago");
    expect(agoLabel("bad", now)).toBe("");
  });
});

describe("recentActivity", () => {
  it("lists the newest started conversations first, at most three", () => {
    const rows = [
      row("ada", {
        conversations: [
          { session: "s1", name: "one", state: "done", ended: true, started_at: "2026-10-03T09:00:00Z" },
          { session: "s2", name: "two", state: "running", ended: false, started_at: "2026-10-03T11:00:00Z" },
        ],
      }),
      row("milo", {
        conversations: [
          { session: "s3", name: "three", state: "done", ended: false, started_at: "2026-10-03T10:00:00Z" },
          { session: "s4", name: "four", state: "done", ended: false, started_at: "2026-10-01T10:00:00Z" },
        ],
      }),
    ];
    expect(recentActivity(rows, now)).toEqual([
      { name: "ada", text: "started “two”", when: "1h ago", href: "#/sessions/s2" },
      { name: "milo", text: "started “three”", when: "2h ago", href: "#/sessions/s3" },
      { name: "ada", text: "started “one”", when: "3h ago", href: "#/sessions/s1" },
    ]);
  });
});
