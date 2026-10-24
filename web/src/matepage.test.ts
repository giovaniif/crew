import { describe, expect, it } from "vitest";
import type { Automation } from "./api";
import { answersIn, latestThread, roleLine, automationRoute, harnessLabel, mateAutomations, mateLine, mateRoute, mateSlug, mateThreads, nameCheck, replyHint, threadSearch, toneSteps } from "./matepage";
import type { MateRow } from "./stream";

const row: MateRow = {
  name: "test-ada",
  state: "connected",
  work: [],
  threads: [
    { mate: "test-ada", team: "T1", channel: "C1", thread_ts: "1.1", session_id: "s1", url: "https://slack/1", session: "Review #42 checkout flake", state: "running", ended: false },
    { mate: "test-ada", team: "T1", channel: "D7", thread_ts: "2.2", session_id: "s3", url: "https://slack/2", session: "Why is CI slow?", state: "done", ended: true },
  ],
  conversations: [
    { session: "s2", name: "Explain the rate limiter", state: "waiting", ended: false, started_at: "2026-10-03T11:00:00Z" },
    { session: "s4", name: "", state: "idle", ended: false, started_at: "2026-10-02T11:00:00Z" },
  ],
};

describe("mateThreads", () => {
  it("tags each thread with its source and puts the ended threads last", () => {
    expect(mateThreads(row).map((t) => [t.session, t.title, t.tag, t.source, t.ended])).toEqual([
      ["s1", "Review #42 checkout flake", "Slack channel", "slack", false],
      ["s2", "Explain the rate limiter", "App", "app", false],
      ["s4", "s4", "App", "app", false],
      ["s3", "Why is CI slow?", "Slack DM", "dm", true],
    ]);
  });

  it("keeps the Slack link of a Slack thread only", () => {
    const [slack, app] = mateThreads(row);
    expect(slack.url).toBe("https://slack/1");
    expect(app.url).toBeUndefined();
  });

  it("gives a mate without Slack only its app threads", () => {
    expect(mateThreads({ ...row, threads: [] }).every((t) => t.source === "app")).toBe(true);
  });
});

describe("threadSearch", () => {
  it("matches the title and the tag, without case", () => {
    const all = mateThreads(row);
    expect(threadSearch(all, "RATE").map((t) => t.session)).toEqual(["s2"]);
    expect(threadSearch(all, "dm").map((t) => t.session)).toEqual(["s3"]);
    expect(threadSearch(all, " ")).toHaveLength(4);
  });
});

describe("replyHint", () => {
  it("tells that a reply in a Slack thread also posts to Slack", () => {
    const [slack, app] = mateThreads(row);
    expect(replyHint(slack, "test-ada")).toBe("Reply in this thread. It also posts to Slack.");
    expect(replyHint(app, "test-ada")).toBe("Message Test-ada…");
  });
});

describe("harnessLabel and mateLine", () => {
  it("names Pi for the agent omp and adds the model", () => {
    expect(harnessLabel("omp", "")).toBe("Pi");
    expect(harnessLabel("claude", "opus")).toBe("Claude · opus");
    expect(harnessLabel("codex")).toBe("Codex");
  });

  it("gives the phone header line: environment, harness, state", () => {
    expect(mateLine("Local", "claude", "Working")).toBe("Local · Claude · working");
  });
});

describe("nameCheck", () => {
  const defs = [{ name: "test-ada", prompt: "", agent: "claude", enabled: true }];
  it("says a free name is free", () => {
    expect(nameCheck("test-nova", defs)).toEqual({ ok: true, text: "name is free" });
  });
  it("refuses an empty name, a taken name and a name that is not a handle", () => {
    expect(nameCheck("", defs).ok).toBe(false);
    expect(nameCheck("test-ada", defs)).toEqual({ ok: false, text: "A mate named test-ada exists." });
    expect(nameCheck("Nova Bot", defs)).toEqual({ ok: false, text: "Use up to 32 letters, digits, - and _." });
  });
});

describe("mateRoute", () => {
  it("reads the mate, the thread and the Slack connect step from the hash", () => {
    expect(mateRoute("#/mates/test-ada")).toEqual({ name: "test-ada", thread: "", connect: false });
    expect(mateRoute("#/mates/test-ada/s%201")).toEqual({ name: "test-ada", thread: "s 1", connect: false });
    expect(mateRoute("#/mates/test-ada/~slack")).toEqual({ name: "test-ada", thread: "", connect: true });
  });
});

function auto(name: string, extra: Partial<Automation> = {}): Automation {
  return { name, agent: "claude", prompt: "TEST", enabled: true, source: "/h/config.toml", ...extra };
}

describe("automations of a mate", () => {
  it("tags a conversation that an automation started as Automation", () => {
    const items = mateThreads({ ...row, threads: [], conversations: [{ session: "s9", name: "TEST weekly", state: "idle", ended: false, started_at: "2026-10-23T10:00:00Z", automation: "test-weekly" }] });
    expect(items.map((t) => [t.session, t.tag, t.source])).toEqual([["s9", "Automation", "automation"]]);
    expect(replyHint(items[0], "test-ada")).toBe("Message Test-ada…");
  });

  it("lists only the automations of the mate, with when they run", () => {
    const list = [
      auto("test-weekly", { mate: "test-ada", schedule: "weekly mon 09:00" }),
      auto("test-ci", { mate: "test-ada", on: ["pr.ci_failed"] }),
      auto("test-hand", { mate: "test-ada" }),
      auto("test-other", { mate: "test-milo" }),
      auto("test-solo"),
    ];
    expect(mateAutomations(list, "test-ada")).toEqual([
      { name: "test-ci", when: "on pr.ci_failed" },
      { name: "test-hand", when: "manual" },
      { name: "test-weekly", when: "weekly mon 09:00" },
    ]);
  });

  it("reads the mate of a new automation from the route", () => {
    expect(automationRoute("#/automations/new?mate=test-ada")).toEqual({ creating: true, mate: "test-ada" });
    expect(automationRoute("#/automations/new")).toEqual({ creating: true, mate: "" });
    expect(automationRoute("#/automations")).toEqual({ creating: false, mate: "" });
  });
});

describe("answersIn", () => {
  it("names the Slack channels of the mate and its DMs", () => {
    expect(answersIn(["api", "web"])).toBe("#api, #web, DMs");
    expect(answersIn([])).toBe("DMs");
    expect(answersIn(undefined)).toBe("DMs");
  });
});

describe("toneSteps", () => {
  it("turns a saved tone back into slider steps", () => {
    const tones = [
      { key: "terse", low: "Terse", high: "Wordy", steps: [] },
      { key: "formal", low: "Casual", high: "Formal", steps: [] },
    ];
    expect(toneSteps(tones, { terse: 1, formal: 5 })).toEqual([0, 4]);
    expect(toneSteps(tones, undefined)).toEqual([2, 2]);
    expect(toneSteps(tones, { terse: 9 })).toEqual([2, 2]);
  });
});

describe("roleLine", () => {
  it("keeps the first sentence of the first line", () => {
    expect(roleLine("You are test-ux for the web app (repo test/web, at ~/www/web). It is a pool app.\nMore.")).toBe("You are test-ux for the web app (repo test/web, at ~/www/web).");
  });

  it("keeps a first line with no sentence end", () => {
    expect(roleLine("  Review the api\n\nMore.")).toBe("Review the api");
  });
});

describe("latestThread", () => {
  const item = (session: string, ended: boolean, at?: string) => ({ session, title: session, tag: "App", source: "app" as const, state: "idle" as const, ended, at });

  it("opens the newest live thread", () => {
    expect(latestThread([item("a", false, "2026-10-01T10:00:00Z"), item("b", false, "2026-10-03T10:00:00Z"), item("c", true, "2026-10-04T10:00:00Z")])?.session).toBe("b");
  });

  it("opens the newest ended thread when no thread is live", () => {
    expect(latestThread([item("a", true, "2026-10-01T10:00:00Z"), item("b", true, "2026-10-02T10:00:00Z")])?.session).toBe("b");
  });

  it("has no thread for a mate with no threads", () => {
    expect(latestThread([])).toBeUndefined();
  });
});

describe("mateSlug", () => {
  it.each([
    ["UX Patrol", "ux-patrol"],
    ["  Ada  ", "ada"],
    ["Zoë Café 2", "zoe-cafe-2"],
    ["R2_D2", "r2_d2"],
    ["--Bot!!", "bot"],
    ["Ünïcode -- Team.", "unicode-team"],
    ["!!!", ""],
  ])("saves %s as %s", (text, slug) => {
    expect(mateSlug(text)).toBe(slug);
  });
});
