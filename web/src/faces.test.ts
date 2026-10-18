import { describe, expect, it } from "vitest";
import { faceColor, faceOf, faceState, faceSvg, faceGlyph, FACES, toneLines, tonePrompt, TONES } from "./faces";
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
    expect(faceState(row({ guard: "rate_limit", conversations: [{ id: "b", session: "", state: "waiting", ended: false }] }), [])).toBe("paused");
    expect(faceState(row(), ["zed"])).toBe("needs");
    expect(faceState(row(), ["other"])).toBe("idle");
    expect(faceState(row({ conversations: [{ id: "b", session: "", state: "waiting", ended: false }] }), [])).toBe("needs");
    expect(faceState(row({ conversations: [{ id: "c", session: "", state: "permission", ended: true }] }), [])).toBe("idle");
    expect(faceState(row({ conversations: [{ id: "a", session: "", state: "running", ended: false }] }), [])).toBe("working");
    expect(faceState(row({ threads: [{ mate: "zed", team: "T", channel: "C", thread_ts: "1", session_id: "a", url: "", session: "", state: "running", ended: false }] }), [])).toBe("working");
    expect(faceState(row({ conversations: [{ id: "d", session: "", state: "idle", ended: false }] }), [])).toBe("idle");
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

describe("tone", () => {
  it("has three axes of five steps, and the middle step adds no text", () => {
    expect(TONES.map((t) => [t.low, t.high])).toEqual([
      ["Terse", "Chatty"],
      ["Cautious", "Bold"],
      ["Formal", "Playful"],
    ]);
    for (const t of TONES) {
      expect(t.steps).toHaveLength(5);
      expect(t.steps[2]).toBe("");
    }
  });

  it("adds one sentence for each step off the middle", () => {
    expect(toneLines([1, 2, 4])).toEqual(["Keep answers short. Use lists, not paragraphs.", "Be playful and use humor."]);
    expect(toneLines([0, 1, 3])).toEqual([
      "Answer in as few words as you can.",
      "Ask before you run a command that changes files or pushes.",
      "Use a friendly, relaxed tone.",
    ]);
    expect(toneLines([3, 4, 0])).toEqual(["Explain your steps as you work.", "Act on your own judgment and move fast.", "Use a formal, professional tone."]);
    expect(toneLines([4, 3, 1])).toEqual(["Talk freely and think out loud.", "Make reasonable choices without asking.", "Keep a calm, neutral tone."]);
  });

  it("appends the sentences to the prompt after a blank line", () => {
    expect(tonePrompt("Review code.", [2, 2, 2])).toBe("Review code.");
    expect(tonePrompt("Review code.  ", [1, 2, 2])).toBe("Review code.\n\nKeep answers short. Use lists, not paragraphs.");
    expect(tonePrompt("Review code.", [0, 4, 2])).toBe("Review code.\n\nAnswer in as few words as you can. Act on your own judgment and move fast.");
  });
});
