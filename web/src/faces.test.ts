import { describe, expect, it } from "vitest";
import { faceColor, faceOf, faceState, faceSvg, faceGlyph, FACES, gallery, mateCard, memoryMeter, toneLines, toneOf } from "./faces";
import type { MateRow } from "./stream";

const row = (over: Partial<MateRow> = {}): MateRow => ({ name: "zed", state: "ready", work: [], threads: [], conversations: [], ...over });

describe("faces", () => {
  it("has the twelve faces of the design in order", () => {
    expect(FACES.map((f) => f.id)).toEqual(["pip", "bolt", "sage", "visor", "iris", "owl", "dash", "wink", "prism", "moss", "beacon", "quill"]);
    expect(FACES.find((f) => f.id === "bolt")?.accent).toEqual(["#209fb5", "#74c7ec"]);
  });

  it("takes the avatar first, then the face with the mate name, then a face from the name bytes", () => {
    expect(faceOf("helper", "owl").id).toBe("owl");
    expect(faceOf("sage", "").id).toBe("sage");
    expect(faceOf("sage", "nope").id).toBe("sage");
    expect(faceOf("ab", undefined).id).toBe(FACES[(97 + 98) % 12].id);
    expect(faceOf("é", undefined).id).toBe(FACES[(0xc3 + 0xa9) % 12].id);
  });

  it("takes the mate color first, else the accent of the face for the theme", () => {
    expect(faceColor(faceOf("pip"), "#123456", false)).toBe("#123456");
    expect(faceColor(faceOf("pip"), undefined, false)).toBe("#7287fd");
    expect(faceColor(faceOf("pip"), "", true)).toBe("#b4befe");
  });

  it("derives the face state from the board, the approvals and the conversations", () => {
    expect(faceState(row({ state: "paused" }), [])).toBe("paused");
    expect(faceState(row({ guard: "rate_limit", conversations: [{ session: "b", name: "", started_at: "", state: "waiting", ended: false }] }), [])).toBe("paused");
    expect(faceState(row(), ["zed"])).toBe("needs");
    expect(faceState(row(), ["other"])).toBe("idle");
    expect(faceState(row({ conversations: [{ session: "b", name: "", started_at: "", state: "waiting", ended: false }] }), [])).toBe("needs");
    expect(faceState(row({ conversations: [{ session: "c", name: "", started_at: "", state: "permission", ended: true }] }), [])).toBe("idle");
    expect(faceState(row({ conversations: [{ session: "a", name: "", started_at: "", state: "running", ended: false }] }), [])).toBe("working");
    expect(faceState(row({ threads: [{ mate: "zed", team: "T", channel: "C", thread_ts: "1", session_id: "a", url: "", session: "", state: "running", ended: false }] }), [])).toBe("working");
    expect(faceState(row({ conversations: [{ session: "d", name: "", started_at: "", state: "idle", ended: false }] }), [])).toBe("idle");
  });

  it("draws a labelled svg with the state marks", () => {
    expect(faceSvg(faceOf("pip"), "working", "#7287fd", 40)).toContain('aria-label="Pip working"');
    expect(faceSvg(faceOf("pip"), "working", "#7287fd", 40)).toContain("cf-spin");
    expect(faceSvg(faceOf("pip"), "needs", "#7287fd", 40)).toContain("--cf-attn");
    expect(faceSvg(faceOf("pip"), "paused", "#7287fd", 40)).toContain('opacity="0.45"');
    expect(faceSvg(faceOf("pip"), "idle", "#7287fd", 64)).toContain('width="64"');
  });

  it("gives the two-line glyph with the marks of the state", () => {
    expect(faceGlyph(faceOf("pip"), "idle")).toEqual(["[● ●]", "[ ‿ ]"]);
    expect(faceGlyph(faceOf("pip"), "working")).toEqual(["[● ●]", "[ ‿ ] ⠋"]);
    expect(faceGlyph(faceOf("pip"), "needs")).toEqual(["[● ●] !", "[ o ]"]);
    expect(faceGlyph(faceOf("pip"), "paused")).toEqual(["[─ ─]", "[ ─ ]"]);
  });
});

const tones = [
  { key: "terse", low: "Terse", high: "Chatty", steps: ["T1", "T2", "", "T4", "T5"] },
  { key: "cautious", low: "Cautious", high: "Bold", steps: ["C1", "C2", "", "C4", "C5"] },
];

describe("tone", () => {
  it("takes one sentence from the server axes for each step off the middle", () => {
    expect(toneLines(tones, [1, 2])).toEqual(["T2"]);
    expect(toneLines(tones, [0, 4])).toEqual(["T1", "C5"]);
    expect(toneLines(tones, [3, 3])).toEqual(["T4", "C4"]);
    expect(toneLines(tones, [2, 2])).toEqual([]);
  });

  it("sends each step plus one by the axis key", () => {
    expect(toneOf(tones, [1, 2])).toEqual({ terse: 2, cautious: 3 });
    expect(toneOf(tones, [0, 4])).toEqual({ terse: 1, cautious: 5 });
  });
});

const conv = (name: string, state: MateRow["threads"][number]["state"], ended = false) => ({ session: name, name, started_at: "", state, ended });

describe("mate cards", () => {
  const def = (over = {}) => ({ name: "zed", prompt: "Reviews diffs.\nWith care.\n\nMore rules.", agent: "claude", enabled: true, ...over });

  it("takes the first paragraph of the prompt as the tagline", () => {
    expect(mateCard(row(), def(), []).tagline).toBe("Reviews diffs.\nWith care.");
  });

  it("counts the live conversations and threads", () => {
    const card = mateCard(row({ conversations: [conv("a", "idle"), conv("b", "done", true)] }), def(), []);
    expect(card.live).toBe(1);
    expect(card.liveLabel).toBe("1 live");
    expect(mateCard(row(), def(), []).liveLabel).toBe("No live chats");
  });

  it("writes the status line as the Mac app does", () => {
    expect(mateCard(row({ state: "paused" }), def(), []).status).toBe("Paused");
    expect(mateCard(row(), def({ enabled: false }), []).status).toBe("Paused");
    expect(mateCard(row({ guard: "rate_limit" }), def(), []).status).toBe("Held · rate limit");
    expect(mateCard(row(), def(), ["zed"]).status).toBe("Needs you");
    expect(mateCard(row({ conversations: [conv("fix", "permission")] }), def(), []).status).toBe("Needs you");
    expect(mateCard(row({ conversations: [conv("done one", "done"), conv("add login", "running")] }), def(), []).status).toBe("Working on add login");
    expect(mateCard(row({ conversations: [conv("add login", "done")] }), def(), []).status).toBe("Finished add login");
    expect(mateCard(row(), def(), []).status).toBe("Idle");
  });
});

describe("gallery", () => {
  const cards = [
    mateCard(row({ name: "ann", conversations: [conv("x", "running")] }), { name: "ann", prompt: "Fixes CSS.", agent: "claude", enabled: true }, []),
    mateCard(row({ name: "bob" }), { name: "bob", prompt: "Writes docs.\n\nSecret rule.", agent: "codex", enabled: true }, []),
    mateCard(row({ name: "cat" }), undefined, []),
  ];

  it("filters by source and counts each source", () => {
    expect(gallery(cards, "all", "").map((c) => c.name)).toEqual(["ann", "bob", "cat"]);
    expect(gallery(cards, "live", "").map((c) => c.name)).toEqual(["ann"]);
    expect(gallery(cards, "claude", "").map((c) => c.name)).toEqual(["ann"]);
    expect(gallery(cards, "codex", "").map((c) => c.name)).toEqual(["bob"]);
  });

  it("searches the name and the first paragraph of the prompt, without case", () => {
    expect(gallery(cards, "all", " DOCS ").map((c) => c.name)).toEqual(["bob"]);
    expect(gallery(cards, "all", "secret")).toEqual([]);
    expect(gallery(cards, "all", "ca").map((c) => c.name)).toEqual(["cat"]);
    expect(gallery(cards, "codex", "css")).toEqual([]);
  });
});

describe("memory meter", () => {
  it("measures the UTF-8 size against the limit", () => {
    expect(memoryMeter("", 8192)).toEqual({ fraction: 0, full: false, label: "Empty · 8 KB limit" });
    expect(memoryMeter("é", 8192).label).toBe("2 bytes of 8 KB");
    expect(memoryMeter("a".repeat(2048), 8192)).toEqual({ fraction: 0.25, full: false, label: "2.0 KB of 8 KB" });
    expect(memoryMeter("a".repeat(9000), 8192)).toEqual({ fraction: 1, full: true, label: "8.8 KB of 8 KB" });
  });
});
