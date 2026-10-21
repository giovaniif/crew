import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { loadSettings } from "../settings";
import { assignShortcut, comboFor, comboLabel, defaultShortcuts, restoreShortcut } from "../shortcuts";
import { desktop } from "../test/desktop";

afterEach(() => {
  window.location.hash = "";
});

describe("the shortcut rules", () => {
  it("gives each action its default combo", () => {
    expect(comboFor(defaultShortcuts(), "newSession")).toEqual({ key: "n", mods: ["meta"] });
    expect(comboFor(defaultShortcuts(), "nextWaiting")).toEqual({ key: "space", mods: ["ctrl"] });
  });

  it("binds a free combo that has Cmd or Ctrl", () => {
    const out = assignShortcut(defaultShortcuts(), "filter", { key: "j", mods: ["shift", "meta"] });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(comboFor(out.shortcuts, "filter")).toEqual({ key: "j", mods: ["shift", "meta"] });
    }
  });

  it("refuses a combo that a different action has", () => {
    const out = assignShortcut(defaultShortcuts(), "filter", { key: "n", mods: ["meta"] });
    expect(out).toEqual({ ok: false, message: "⌘N is already used by New session" });
  });

  it("refuses Cmd or Ctrl with 1 to 9, which jump to a session", () => {
    expect(assignShortcut(defaultShortcuts(), "filter", { key: "1", mods: ["meta"] })).toEqual({ ok: false, message: "⌘1 is already used by Jump to session N" });
    expect(assignShortcut(defaultShortcuts(), "filter", { key: "9", mods: ["ctrl"] })).toEqual({ ok: false, message: "⌃9 is already used by Jump to session N" });
  });

  it("refuses a combo with no Cmd or Ctrl, so the terminal keeps plain keys", () => {
    expect(assignShortcut(defaultShortcuts(), "filter", { key: "k", mods: ["shift", "alt"] })).toEqual({ ok: false, message: "⌥⇧K needs ⌘ or ⌃, so the terminal keeps plain keys" });
  });

  it("refuses the fixed combos", () => {
    expect(assignShortcut(defaultShortcuts(), "filter", { key: ",", mods: ["meta"] })).toEqual({ ok: false, message: "⌘, is already used by Settings" });
  });

  it("clears a combo and restores the default", () => {
    const cleared = assignShortcut(defaultShortcuts(), "review", null);
    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(comboFor(cleared.shortcuts, "review")).toBeNull();
      expect(comboFor(restoreShortcut(cleared.shortcuts, "review"), "review")).toEqual({ key: "r", mods: ["meta"] });
    }
  });

  it("writes the combo with words off a Mac", () => {
    expect(comboLabel({ key: "t", mods: ["meta", "shift"] }, false)).toBe("Shift+Meta+T");
    expect(comboLabel({ key: "space", mods: ["ctrl"] }, true)).toBe("⌃Space");
  });
});

describe("the Shortcuts settings", () => {
  async function openShortcuts() {
    const view = desktop("#/settings", true, "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)");
    view.live();
    await userEvent.click(within(screen.getByRole("list", { name: "This app" })).getByRole("button", { name: "Shortcuts" }));
    return view;
  }

  it("records a new combo and keeps it in the app store", async () => {
    const { storage } = await openShortcuts();
    const row = screen.getByRole("row", { name: /Filter sessions/ });
    expect(row).toHaveTextContent("⌘K");
    await userEvent.click(within(row).getByRole("button", { name: "Change" }));
    await userEvent.keyboard("{Meta>}{Shift>}j{/Shift}{/Meta}");
    expect(row).toHaveTextContent("⇧⌘J");
    expect(comboFor(loadSettings(storage).shortcuts, "filter")).toEqual({ key: "j", mods: ["shift", "meta"] });
  });

  it("tells why a combo is refused and keeps the old one", async () => {
    const { storage } = await openShortcuts();
    const row = screen.getByRole("row", { name: /Filter sessions/ });
    await userEvent.click(within(row).getByRole("button", { name: "Change" }));
    await userEvent.keyboard("{Meta>}n{/Meta}");
    expect(screen.getByRole("alert")).toHaveTextContent("⌘N is already used by New session");
    expect(row).toHaveTextContent("⌘K");
    expect(comboFor(loadSettings(storage).shortcuts, "filter")).toEqual({ key: "k", mods: ["meta"] });
  });
});
