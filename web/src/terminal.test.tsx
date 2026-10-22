import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TerminalPane } from "./screens/Terminal";
import { closeNoPane, TerminalStore } from "./terminal";
import { session } from "./test/desktop";
import { FakeTerminals } from "./test/fake-terminal";

function agentAfterGone() {
  const terminals = new FakeTerminals();
  const store = new TerminalStore(terminals.env, "t0k", () => Promise.reject(new Error("unused")));
  const s = session("s1", "api", { Pane: "%1" });
  const entry = store.entry(s, "agent");
  entry.start();
  terminals.socket("%1").open();
  terminals.socket("%1").drop(closeNoPane);
  return { terminals, store, entry };
}

describe("the agent terminal after 4404", () => {
  it("does not open the same stale pane again", () => {
    const { terminals, entry } = agentAfterGone();
    act(() => entry.retry());
    expect(terminals.sockets.map((s) => s.pane)).toEqual(["%1"]);
    expect(entry.status.kind).toBe("paneClosed");
  });

  it("opens the new pane when the stream gives a different one", async () => {
    const { terminals, store } = agentAfterGone();
    store.entry(session("s1", "api", { Pane: "%7" }), "agent");
    await act(async () => {
      await Promise.resolve();
    });
    expect(terminals.sockets.map((s) => s.pane)).toEqual(["%1", "%7"]);
  });

  it("says that the session's pane closed", () => {
    const { store } = agentAfterGone();
    render(<TerminalPane store={store} session={session("s1", "api", { Pane: "%1" })} kind="agent" />);
    expect(screen.getByRole("status").textContent).toContain("This session's pane closed.");
  });
});
