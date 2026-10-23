import { describe, expect, it } from "vitest";
import { harnessLabel, mateLine, mateRoute, mateThreads, nameCheck, replyHint, threadSearch } from "./matepage";
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
