import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { desktop, goldenState, session } from "../test/desktop";

afterEach(() => {
  window.location.hash = "";
});

function rowNames(region: string): string[] {
  return within(screen.getByRole("region", { name: region }))
    .getAllByRole("link")
    .map((a) => a.querySelector(".nm")?.textContent ?? "");
}

describe("the desktop sidebar", () => {
  it("groups the sessions as Needs you, Running and Done in the daemon order", () => {
    const { live } = desktop();
    live({
      ...goldenState(),
      sessions: [
        session("a", "alpha", { order: 2 }),
        session("b", "beta", { order: 0, State: "permission" }),
        session("c", "gamma", { order: -1, Ended: true }),
        session("d", "delta", { order: 1, State: "done" }),
        session("e", "epsilon", { order: 3, State: "idle" }),
      ],
    });
    expect(rowNames("Needs you")).toEqual(["beta"]);
    expect(rowNames("Running")).toEqual(["alpha", "epsilon"]);
    expect(rowNames("Done")).toEqual(["delta", "gamma"]);
  });

  it("puts the sessions that need you first when the stream has no order and hides empty groups", () => {
    const { live } = desktop();
    live({
      ...goldenState(),
      sessions: [session("a", "alpha"), session("b", "beta", { State: "waiting" }), session("c", "gamma", { State: "idle" })],
    });
    expect(rowNames("Needs you")).toEqual(["beta"]);
    expect(rowNames("Running")).toEqual(["alpha", "gamma"]);
    expect(screen.queryByRole("region", { name: "Done" })).not.toBeInTheDocument();
  });

  it("shows a status dot for each state", () => {
    const { live } = desktop();
    live({
      ...goldenState(),
      sessions: [
        session("a", "alpha", { State: "permission" }),
        session("b", "beta", { State: "waiting" }),
        session("c", "gamma"),
        session("d", "delta", { State: "done" }),
      ],
    });
    const dot = (name: string) => screen.getByRole("link", { name: new RegExp(name) }).querySelector(".dot");
    expect(dot("alpha")).toHaveClass("ask");
    expect(dot("beta")).toHaveClass("wait");
    expect(dot("gamma")).toHaveClass("run");
    expect(dot("delta")).toHaveClass("ok");
  });

  it("has a New session button in the head and the footer links", () => {
    const { live } = desktop();
    live();
    const sidebar = within(screen.getByRole("navigation", { name: "Sidebar" }));
    expect(sidebar.getByRole("link", { name: "New session" })).toHaveAttribute("href", "#/new");
    for (const [name, href] of [["Mates", "#/mates"], ["Approvals", "#/approvals"], ["Automations", "#/automations"], ["Disk", "#/disk"], ["Settings", "#/settings"]]) {
      expect(sidebar.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });

  it("shows the shortcut of each of the first nine sessions", () => {
    const { live } = desktop("", true, "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)");
    live();
    const rows = [...within(screen.getByRole("region", { name: "Running" })).getAllByRole("link"), ...within(screen.getByRole("region", { name: "Done" })).getAllByRole("link")];
    expect(rows[0]).toHaveAttribute("aria-keyshortcuts", "Meta+1");
    expect(rows[0]).toHaveTextContent("⌘1");
    expect(rows[1]).toHaveTextContent("⌘2");
  });

  it("shows Ctrl+Shift in the shortcuts on Linux and Windows", () => {
    const { live } = desktop();
    live();
    const rows = [...within(screen.getByRole("region", { name: "Running" })).getAllByRole("link"), ...within(screen.getByRole("region", { name: "Done" })).getAllByRole("link")];
    expect(rows[0]).toHaveAttribute("aria-keyshortcuts", "Control+Shift+1");
    expect(rows[0]).toHaveTextContent("Ctrl+Shift+1");
  });

  it("shows the long Ctrl+Shift hint only on demand so it does not cut the names", () => {
    const { live } = desktop();
    live();
    const rows = [...within(screen.getByRole("region", { name: "Running" })).getAllByRole("link"), ...within(screen.getByRole("region", { name: "Done" })).getAllByRole("link")];
    expect(rows[0].querySelector("kbd")).toHaveClass("on-demand");
  });

  it("keeps the short Cmd hint on each row on a Mac", () => {
    const { live } = desktop("", true, "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)");
    live();
    const rows = [...within(screen.getByRole("region", { name: "Running" })).getAllByRole("link"), ...within(screen.getByRole("region", { name: "Done" })).getAllByRole("link")];
    expect(rows[0].querySelector("kbd")).not.toHaveClass("on-demand");
  });

  it("has a Mates entry and the limits meters", () => {
    const { live } = desktop();
    live();
    const sidebar = within(screen.getByRole("navigation", { name: "Sidebar" }));
    expect(sidebar.getByRole("link", { name: "Mates" })).toHaveAttribute("href", "#/mates");
    expect(sidebar.getByLabelText("Claude limits")).toHaveTextContent(/5h\s*42%/);
    expect(sidebar.getByLabelText("Codex limits")).toHaveTextContent(/5h\s*10%/);
  });

  it("marks a muted session so the user can tell that it sends no banners", () => {
    const { live } = desktop();
    live({ ...goldenState(), sessions: [session("a", "alpha", { Muted: true }), session("b", "beta")] });
    const rows = within(screen.getByRole("region", { name: "Running" }));
    expect(rows.getByRole("link", { name: /alpha/ })).toHaveTextContent("muted");
    expect(rows.getByRole("link", { name: /beta/ })).not.toHaveTextContent("muted");
  });

  it("marks the selected session", () => {
    const { live } = desktop("#/sessions/s2");
    live();
    const rows = [...within(screen.getByRole("region", { name: "Running" })).getAllByRole("link"), ...within(screen.getByRole("region", { name: "Done" })).getAllByRole("link")];
    const selected = rows.filter((r) => r.getAttribute("aria-current") === "page");
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent("add retries");
  });
});
