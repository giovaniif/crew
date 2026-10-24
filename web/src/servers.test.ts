import { describe, expect, it } from "vitest";
import { sshTarget } from "./servers";

describe("an SSH target", () => {
  it("refuses an SSH target with options, spaces or quotes", () => {
    expect(sshTarget(" me@box ")).toBe("me@box");
    expect(sshTarget("-oProxyCommand=sh")).toBeNull();
    expect(sshTarget("box rm")).toBeNull();
    expect(sshTarget("box'")).toBeNull();
    expect(sshTarget("")).toBeNull();
  });
});
