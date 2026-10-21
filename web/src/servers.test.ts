import { describe, expect, it } from "vitest";
import { backStep, flowSteps, nextStep, primaryTitle, sshTarget, stepTitle } from "./servers";

describe("the Add a server flow", () => {
  it("has the six steps of the Mac app, and this computer skips Server", () => {
    expect(flowSteps("ssh").map(stepTitle)).toEqual(["Welcome", "Where agents run", "Server", "Set up", "Workspace", "Done"]);
    expect(flowSteps("url").map(stepTitle)).toEqual(["Welcome", "Where agents run", "Server", "Set up", "Workspace", "Done"]);
    expect(flowSteps("local").map(stepTitle)).toEqual(["Welcome", "Where agents run", "Set up", "Workspace", "Done"]);
  });

  it("goes forward and back over the steps of the choice", () => {
    expect(nextStep("location", "local")).toBe("setup");
    expect(nextStep("location", "ssh")).toBe("host");
    expect(nextStep("host", "url")).toBe("setup");
    expect(nextStep("done", "url")).toBe("done");
    expect(backStep("setup", "local")).toBe("location");
    expect(backStep("setup", "ssh")).toBe("host");
    expect(backStep("welcome", "ssh")).toBe("welcome");
  });

  it("names the primary button for the step", () => {
    expect(primaryTitle("welcome")).toBe("Get started");
    expect(primaryTitle("setup")).toBe("Continue");
    expect(primaryTitle("done")).toBe("Open crew");
  });

  it("refuses an SSH target with options, spaces or quotes", () => {
    expect(sshTarget(" me@box ")).toBe("me@box");
    expect(sshTarget("-oProxyCommand=sh")).toBeNull();
    expect(sshTarget("box rm")).toBeNull();
    expect(sshTarget("box'")).toBeNull();
    expect(sshTarget("")).toBeNull();
  });
});
