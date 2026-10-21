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

  it("opens a session on its shell tab", () => {
    expect(parseRoute("#/sessions/s1/shell")).toEqual({ screen: "session", id: "s1", tab: "shell" });
    expect(parseRoute("#/sessions/s1/other")).toEqual({ screen: "list" });
  });
});
