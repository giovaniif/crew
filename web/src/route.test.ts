import { describe, expect, it } from "vitest";
import { parseRoute } from "./route";

describe("parseRoute", () => {
  it("opens the new session form at #/new", () => {
    expect(parseRoute("#/new")).toEqual({ screen: "new" });
  });

  it("still opens sessions and the list", () => {
    expect(parseRoute("#/sessions/s1")).toEqual({ screen: "session", id: "s1" });
    expect(parseRoute("")).toEqual({ screen: "list" });
    expect(parseRoute("#/new/extra")).toEqual({ screen: "list" });
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
