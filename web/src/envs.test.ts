import { describe, expect, it } from "vitest";
import type { EnvInfo } from "./api";
import { accountRows, envLetter, envSub, envTitle, extraSecrets, matesText, usedLabel } from "./envs";

const local: EnvInfo = { name: "local", kind: "local", parts: [], secrets: [{ name: "LINEAR_API_KEY", set: true }], used_by: ["ada", "june"] };
const work: EnvInfo = {
  name: "work",
  kind: "custom",
  parts: ["git", "ssh", "github", "claude", "codex", "pi"],
  secrets: [
    { name: "GH_TOKEN", set: true },
    { name: "CLAUDE_CODE_OAUTH_TOKEN", set: true },
    { name: "ANTHROPIC_API_KEY", set: false },
    { name: "OPENAI_API_KEY", set: true },
    { name: "GEMINI_API_KEY", set: false },
    { name: "SENTRY_TOKEN", set: true },
  ],
  used_by: ["rex", "milo"],
};

describe("environment rows", () => {
  it("names the local environment for this machine and others by name", () => {
    expect(envTitle(local)).toBe("Local (this Mac)");
    expect(envTitle(work)).toBe("work");
    expect(envLetter(local)).toBe("L");
    expect(envLetter(work)).toBe("W");
  });

  it("tells the kind and how many mates use it", () => {
    expect(envSub(local)).toBe("Your logins · 2 mates");
    expect(envSub({ ...work, used_by: ["rex"] })).toBe("Custom · 1 mate");
    expect(envSub({ ...work, used_by: [] })).toBe("Custom · not used");
    expect(usedLabel(2)).toBe("2 mates");
    expect(usedLabel(1)).toBe("1 mate");
  });

  it("lists the mates in a sentence", () => {
    expect(matesText(["rex", "milo"])).toBe("rex and milo");
    expect(matesText(["rex", "milo", "ada"])).toBe("rex, milo and ada");
    expect(matesText(["rex"])).toBe("rex");
    expect(matesText([])).toBe("No mate");
  });

  it("gives one account row for each harness part, set when one of its keys is set", () => {
    expect(accountRows(work).map((r) => [r.title, r.set])).toEqual([
      ["Claude", true],
      ["Codex", true],
      ["Pi", false],
    ]);
    expect(accountRows({ ...work, parts: ["codex"] }).map((r) => r.title)).toEqual(["Codex"]);
  });

  it("keeps only the variables that no part manages", () => {
    expect(extraSecrets(work).map((s) => s.name)).toEqual(["SENTRY_TOKEN"]);
    expect(extraSecrets(local).map((s) => s.name)).toEqual(["LINEAR_API_KEY"]);
  });
});
