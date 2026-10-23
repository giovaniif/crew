import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { desktop, goldenState, session } from "../test/desktop";

afterEach(() => {
  window.location.hash = "";
});

function rows(region: string) {
  return within(screen.getByRole("region", { name: region })).getAllByRole("link");
}

function cells(link: HTMLElement): string[] {
  return [...link.querySelectorAll("[data-col]")].map((c) => c.getAttribute("data-col") + "=" + (c.textContent ?? "").trim());
}

describe("the Sessions table", () => {
  it("shows one row for each active session with the harness, the repo, the PR and the last activity", () => {
    const { live } = desktop();
    const state = goldenState();
    live({
      ...state,
      worktrees: [{ ...state.worktrees[0], PR: { Number: 61, Title: "x", URL: "", Head: "login", State: "OPEN", Checks: "" } }],
      sessions: [session("s1", "fix the login redirect", { WorktreeIDs: ["w1"], since: "2026-10-03T12:28:00Z", Model: "opus" }), session("s2", "add retries", { Harness: "codex", Model: "", Effort: "high", where: "", since: "2026-10-03T12:29:30Z" })],
    });
    const [first, second] = rows("Active sessions");
    expect(first).toHaveAttribute("href", "#/sessions/s1");
    expect(cells(first)).toEqual(["session=fix the login redirectrunning", "harness=claude · opus", "repo=api@login", "pr=#61", "last=2m"]);
    expect(cells(second)).toEqual(["session=add retriesrunning", "harness=codex · high", "repo=—", "pr=—", "last=now"]);
  });

  it("shows the ended sessions when Ended is on", () => {
    const { live } = desktop();
    live({ ...goldenState(), sessions: [session("a", "alpha"), session("b", "beta", { Ended: true })] });
    expect(rows("Active sessions").map((r) => r.querySelector("[data-col=session] .nm")?.textContent)).toEqual(["alpha"]);
    fireEvent.click(screen.getByRole("radio", { name: "Ended" }));
    expect(rows("Ended sessions").map((r) => r.querySelector("[data-col=session] .nm")?.textContent)).toEqual(["beta"]);
  });

  it("puts the sessions that mates started in their own group under the table", () => {
    const { live } = desktop();
    live({ ...goldenState(), sessions: [session("a", "alpha"), session("m", "review the flake", { Mate: { Name: "ada" } })] });
    expect(rows("Active sessions")).toHaveLength(1);
    const mate = rows("Started by mates");
    expect(mate).toHaveLength(1);
    expect(mate[0]).toHaveTextContent("ada");
    expect(mate[0]).toHaveAttribute("href", "#/sessions/m");
  });

  it("gives each state a dot", () => {
    const { live } = desktop();
    live({ ...goldenState(), sessions: [session("a", "alpha", { State: "permission" }), session("b", "beta", { State: "done" })] });
    const [a, b] = rows("Active sessions");
    expect(a.querySelector(".dot")).toHaveClass("ask");
    expect(b.querySelector(".dot")).toHaveClass("ok");
  });

  it("keeps the session shortcuts on the active rows", () => {
    const { live } = desktop("#/sessions", true, "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)");
    live();
    expect(rows("Active sessions")[0]).toHaveAttribute("aria-keyshortcuts", "Meta+1");
  });
});
