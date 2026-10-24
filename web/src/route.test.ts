import { describe, expect, it } from "vitest";
import { navItem, parseRoute, phoneTab } from "./route";

describe("parseRoute", () => {
  it("opens the new session form at #/new", () => {
    expect(parseRoute("#/new")).toEqual({ screen: "new" });
  });

  it("still opens sessions and the list", () => {
    expect(parseRoute("#/sessions/s1")).toEqual({ screen: "session", id: "s1" });
    expect(parseRoute("#/sessions")).toEqual({ screen: "list" });
    expect(parseRoute("#/new/extra")).toEqual({ screen: "list" });
  });

  it("opens the Mates home at the root and at #/mates", () => {
    for (const hash of ["", "#", "#/", "#/mates"]) {
      expect(parseRoute(hash)).toEqual({ screen: "home" });
    }
  });

  it("opens a session with its shell, editor, agent screen or browser", () => {
    expect(parseRoute("#/sessions/s1/shell")).toEqual({ screen: "session", id: "s1", view: "shell" });
    expect(parseRoute("#/sessions/s1/editor")).toEqual({ screen: "session", id: "s1", view: "editor" });
    expect(parseRoute("#/sessions/s1/agent")).toEqual({ screen: "session", id: "s1", view: "agent" });
    expect(parseRoute("#/sessions/s1/browser")).toEqual({ screen: "session", id: "s1", view: "browser" });
  });

  it("reads the terminal and nvim links of the session menu as the agent screen and the editor", () => {
    expect(parseRoute("#/sessions/s1/terminal")).toEqual({ screen: "session", id: "s1", view: "agent" });
    expect(parseRoute("#/sessions/s1/nvim")).toEqual({ screen: "session", id: "s1", view: "editor" });
    expect(parseRoute("#/sessions/s1/other")).toEqual({ screen: "list" });
  });
});


describe("parseRoute", () => {
  it("opens the new session form at #/new", () => {
    expect(parseRoute("#/new")).toEqual({ screen: "new" });
  });

  it("still opens sessions and the list", () => {
    expect(parseRoute("#/sessions/s1")).toEqual({ screen: "session", id: "s1" });
    expect(parseRoute("#/sessions")).toEqual({ screen: "list" });
    expect(parseRoute("#/new/extra")).toEqual({ screen: "list" });
  });

  it("opens the Mates home at the root and at #/mates", () => {
    for (const hash of ["", "#", "#/", "#/mates"]) {
      expect(parseRoute(hash)).toEqual({ screen: "home" });
    }
  });

  it("opens a session with its shell, editor, agent screen or browser", () => {
    expect(parseRoute("#/sessions/s1/shell")).toEqual({ screen: "session", id: "s1", view: "shell" });
    expect(parseRoute("#/sessions/s1/editor")).toEqual({ screen: "session", id: "s1", view: "editor" });
    expect(parseRoute("#/sessions/s1/agent")).toEqual({ screen: "session", id: "s1", view: "agent" });
    expect(parseRoute("#/sessions/s1/browser")).toEqual({ screen: "session", id: "s1", view: "browser" });
  });

  it("reads the terminal and nvim links of the session menu as the agent screen and the editor", () => {
    expect(parseRoute("#/sessions/s1/terminal")).toEqual({ screen: "session", id: "s1", view: "agent" });
    expect(parseRoute("#/sessions/s1/nvim")).toEqual({ screen: "session", id: "s1", view: "editor" });
    expect(parseRoute("#/sessions/s1/other")).toEqual({ screen: "list" });
  });
});

describe("navItem", () => {
  it.each([
    ["", "mates"],
    ["#/", "mates"],
    ["#/mates", "mates"],
    ["#/mates/new", "mates"],
    ["#/mates/test-ada/s1", "mates"],
    ["#/sessions", "sessions"],
    ["#/sessions/s1", "sessions"],
    ["#/sessions/s1/shell", "sessions"],
    ["#/new", "new"],
    ["#/approvals", "approvals"],
    ["#/automations", "automations"],
    ["#/automations/new?mate=test-ada", "automations"],
    ["#/automations/test-weekly", "automations"],
    ["#/envs", "envs"],
    ["#/envs/test-work", "envs"],
    ["#/disk", "disk"],
    ["#/settings", "settings"],
    ["#/servers", "settings"],
    ["#/more", "more"],
    ["#/elsewhere", "sessions"],
  ])("marks %s as %s", (hash, item) => {
    expect(navItem(hash)).toBe(item);
  });
});

describe("phoneTab", () => {
  it.each([
    ["#/", "mates"],
    ["#/mates/test-ada", "mates"],
    ["#/sessions", "sessions"],
    ["#/sessions/s1", "sessions"],
    ["#/approvals", "approvals"],
    ["#/automations", "more"],
    ["#/envs/test-work", "more"],
    ["#/disk", "more"],
    ["#/settings", "more"],
    ["#/more", "more"],
  ])("marks %s as %s", (hash, tab) => {
    expect(phoneTab(hash)).toBe(tab);
  });
});
