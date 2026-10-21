import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Deferred } from "../test/fake-server";
import { desktop } from "../test/desktop";

afterEach(() => {
  window.location.hash = "";
});

const slow = { retryDelay: () => 60000 };

function banner() {
  return within(screen.getByRole("navigation", { name: "Sidebar" })).getByRole("status");
}

describe("the connection banner", () => {
  it("says there is no crew daemon when the daemon is not reachable", () => {
    const { live, sockets } = desktop("", true, undefined, slow);
    live();
    sockets.last.drop(1013, "the crew daemon is not reachable: connect: no such file or directory");
    expect(banner()).toHaveTextContent("No crew daemon · retrying");
    expect(banner()).toHaveTextContent("connect: no such file or directory");
  });

  it("counts down to the next try when the connection drops", () => {
    const { live, sockets } = desktop("", true, undefined, { retryDelay: () => 7000 });
    live();
    sockets.last.drop(1006);
    expect(banner()).toHaveTextContent("Reconnecting in 7 s");
  });

  it("stops on a build mismatch and connects again on Reconnect", async () => {
    const { live, sockets } = desktop("", true, undefined, { retryDelay: () => 5 });
    live();
    sockets.last.drop(4502, "daemon runs crew v0.13.0 but this client is v0.12.0");
    expect(banner()).toHaveTextContent("Build mismatch · stopped");
    expect(banner()).toHaveTextContent("daemon runs crew v0.13.0");
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(sockets.opened).toHaveLength(1);
    expect(within(banner()).queryByRole("button", { name: "Fix" })).not.toBeInTheDocument();
    await userEvent.click(within(banner()).getByRole("button", { name: "Reconnect" }));
    expect(sockets.opened).toHaveLength(2);
  });

  it("has no Fix outside the desktop app", () => {
    const { live, sockets } = desktop("", true, undefined, slow);
    live();
    sockets.last.drop(1013, "the crew daemon went away");
    expect(within(banner()).queryByRole("button", { name: "Fix" })).not.toBeInTheDocument();
  });

  it("offers Fix in the desktop app while it retries and while it reconnects", async () => {
    const { live, sockets } = desktop("", true, undefined, { retryDelay: (n) => (n === 0 ? 5 : 60000), desktopFix: async () => undefined });
    live();
    sockets.last.drop(1013, "the crew daemon went away");
    expect(within(banner()).getByRole("button", { name: "Fix" })).toBeInTheDocument();
    await waitFor(() => expect(sockets.opened).toHaveLength(2));
    sockets.last.drop(1006);
    expect(banner()).toHaveTextContent("Reconnecting in");
    expect(within(banner()).getByRole("button", { name: "Fix" })).toBeInTheDocument();
  });

  it("runs the fix and then connects again", async () => {
    const done = new Deferred<void>();
    let fixed = 0;
    const { live, sockets } = desktop("", true, undefined, {
      ...slow,
      desktopFix: () => {
        fixed++;
        return done.promise;
      },
    });
    live();
    sockets.last.drop(1013, "the crew daemon went away");
    await userEvent.click(within(banner()).getByRole("button", { name: "Fix" }));
    expect(fixed).toBe(1);
    expect(banner()).toHaveTextContent("Fixing the daemon");
    await act(async () => done.resolve());
    await waitFor(() => expect(sockets.opened).toHaveLength(2));
  });

  it("shows the reason of the check when the fix fails", async () => {
    const { live, sockets } = desktop("", true, undefined, {
      ...slow,
      desktopFix: () => Promise.reject(new Error("the unit runs /usr/local/bin/crew, which does not exist")),
    });
    live();
    sockets.last.drop(1013, "the crew daemon went away");
    await userEvent.click(within(banner()).getByRole("button", { name: "Fix" }));
    expect(await within(banner()).findByText(/Fix failed · retrying/)).toBeInTheDocument();
    expect(banner()).toHaveTextContent("the unit runs /usr/local/bin/crew, which does not exist");
    expect(within(banner()).getByRole("button", { name: "Fix" })).toBeInTheDocument();
    expect(sockets.opened).toHaveLength(1);
  });
});

describe("the desktop app without crew serve", () => {
  it("shows why crew did not start and a Fix, not the pairing screen", async () => {
    let fixed = 0;
    desktop("", true, undefined, {
      desktopAuth: null,
      desktopProblem: "crew is not in the app bundle or on PATH",
      desktopFix: async () => void fixed++,
    });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("crew is not running");
    expect(status).toHaveTextContent("crew is not in the app bundle or on PATH");
    expect(screen.queryByRole("heading", { name: "Pair this device" })).not.toBeInTheDocument();
    await userEvent.click(within(status).getByRole("button", { name: "Fix" }));
    expect(fixed).toBe(1);
  });

  it("shows the reason when that fix fails", async () => {
    desktop("", true, undefined, {
      desktopProblem: "crew serve did not start",
      desktopFix: () => Promise.reject(new Error("crew setup daemon: linger is off")),
    });
    await userEvent.click(screen.getByRole("button", { name: "Fix" }));
    expect(await screen.findByText(/Fix failed/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("crew setup daemon: linger is off");
  });
});
