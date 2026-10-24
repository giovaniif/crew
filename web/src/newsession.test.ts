import { describe, expect, it } from "vitest";
import { loadChoices, placeLine, rememberWorkspace, rememberedRoot, saveChoices } from "./newsession";
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

describe("where the new session runs", () => {
  it("names the new worktree of a git repo", () => {
    expect(placeLine({ worktree: "api-12", dir: "/h/wt/api/api-12", git: true }, "/home/me")).toBe("→ new worktree api-12");
  });

  it("says a folder with no git runs in place with no worktree", () => {
    expect(placeLine({ worktree: "", dir: "/home/me", git: false }, "/home/me")).toBe("→ runs in ~/ (not a git repo, no worktree)");
    expect(placeLine({ worktree: "", dir: "/srv/notes", git: false }, "/home/me")).toBe("→ runs in /srv/notes (not a git repo, no worktree)");
  });

  it("says a folder of repos runs at its root with no worktree", () => {
    expect(placeLine({ worktree: "", dir: "/home/me/shop", git: true }, "/home/me")).toBe("→ runs in ~/shop (no worktree)");
  });
});
