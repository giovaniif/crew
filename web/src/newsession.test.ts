import { describe, expect, it } from "vitest";
import { loadChoices, rememberWorkspace, rememberedRoot, saveChoices } from "./newsession";
import { MemoryStorage } from "./test/fake-server";

describe("the default project", () => {
  it("keeps the first workspace of onboarding and the other choices", () => {
    const storage = new MemoryStorage();
    saveChoices(storage, { workspace: "", harness: "codex", model: "gpt-5.5", effort: "high" });
    rememberWorkspace(storage, " ~/code/web ");
    expect(loadChoices(storage)).toEqual({ workspace: "~/code/web", harness: "codex", model: "gpt-5.5", effort: "high" });
  });

  it("finds the root of a remembered path that starts with ~", () => {
    const roots = ["/home/me/code/api", "/home/me/code/web"];
    expect(rememberedRoot("~/code/web", roots)).toBe("/home/me/code/web");
    expect(rememberedRoot("/home/me/code/api", roots)).toBe("/home/me/code/api");
    expect(rememberedRoot("~/code/we", roots)).toBe("");
    expect(rememberedRoot("", roots)).toBe("");
  });
});
