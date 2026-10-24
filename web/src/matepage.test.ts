import { describe, expect, it } from "vitest";
import type { Automation } from "./api";
import { answersIn, automationRoute, harnessLabel, mateAutomations, mateHistory, mateLine, mateRoute, messageSource, nameCheck, replyHint, shownConversation, toneSteps } from "./matepage";
import type { MateRow } from "./stream";

const row: MateRow = {
  name: "test-ada",
  state: "connected",
  work: [],
  threads: [],
  conversation: "s2",
  conversations: [
    { session: "s2", name: "Explain the rate limiter", state: "waiting", ended: false, started_at: "2026-10-03T11:00:00Z", history: false },
    { session: "s1", name: "Review #42", state: "idle", ended: true, started_at: "2026-10-02T11:00:00Z", history: true },
    { session: "s0", name: "", state: "idle", ended: true, started_at: "2026-10-01T11:00:00Z", history: true },
  ],
};

describe("mateHistory", () => {
  it("lists the old conversations newest first, with the session as the title when it has no name", () => {
    expect(mateHistory(row).map((c) => [c.session, c.title])).toEqual([
      ["s1", "Review #42"],
      ["s0", "s0"],
    ]);
  });
});

describe("shownConversation", () => {
  it("shows the conversation, or a history session that the route names", () => {
    expect(shownConversation(row, "")).toEqual({ session: "s2", history: false });
    expect(shownConversation(row, "s1")).toEqual({ session: "s1", history: true });
    expect(shownConversation(row, "nope")).toEqual({ session: "s2", history: false });
    expect(shownConversation({ ...row, conversation: "", conversations: [] }, "")).toEqual({ session: "", history: false });
  });
});

describe("messageSource", () => {
  it("reads the source line on top of an input and keeps the rest", () => {
    expect(messageSource("Source: #C0CHAN1\n\nlook at it")).toEqual({ tag: "#C0CHAN1", text: "look at it" });
    expect(messageSource("Source: DM\n\nhi")).toEqual({ tag: "DM", text: "hi" });
    expect(messageSource("Source: Automation weekly\n\nTEST check")).toEqual({ tag: "Automation", text: "TEST check" });
    expect(messageSource("fix the bug")).toEqual({ tag: "App", text: "fix the bug" });
    expect(messageSource("Source: nothing after")).toEqual({ tag: "App", text: "Source: nothing after" });
  });
});

describe("replyHint", () => {
  it("names the mate", () => {
    expect(replyHint("test-ada")).toBe("Message Test-ada…");
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
