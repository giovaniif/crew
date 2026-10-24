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
  it("is a thin row with a spinner and Retry while it reconnects", async () => {
    const { live, sockets } = desktop("#/sessions", true, undefined, { retryDelay: () => 7000 });
    live();
    sockets.last.drop(1006);
    expect(banner().querySelector(".spin")).not.toBeNull();
    await userEvent.click(within(banner()).getByRole("button", { name: "Retry" }));
    expect(sockets.opened).toHaveLength(2);
  });

  it("copies the update command on a build mismatch", async () => {
    const user = userEvent.setup();
    const { live, sockets } = desktop("#/sessions", true, undefined, slow);
    live();
    sockets.last.drop(4502, "daemon runs crew v0.13.0 but this client is v0.12.0");
    await user.click(within(banner()).getByRole("button", { name: "Copy update command" }));
    expect(await navigator.clipboard.readText()).toContain("scripts/install.sh | sh");
    expect(banner()).toHaveTextContent("Copied");
  });

  it("says there is no crew daemon when the daemon is not reachable", () => {
    const { live, sockets } = desktop("#/sessions", true, undefined, slow);
    live();
    sockets.last.drop(1013, "the crew daemon is not reachable: connect: no such file or directory");
    expect(banner()).toHaveTextContent("No crew daemon · retrying");
    expect(banner()).toHaveTextContent("connect: no such file or directory");
  });

  it("counts down to the next try when the connection drops", () => {
    const { live, sockets } = desktop("#/sessions", true, undefined, { retryDelay: () => 7000 });
    live();
    sockets.last.drop(1006);
    expect(banner()).toHaveTextContent("Reconnecting in 7 s");
  });

  it("stops on a build mismatch and connects again on Reconnect", async () => {
    const { live, sockets } = desktop("#/sessions", true, undefined, { retryDelay: () => 5 });
    live();
    sockets.last.drop(4502, "daemon runs crew v0.13.0 but this client is v0.12.0");
    expect(banner()).toHaveTextContent("The server runs another crew version");
    expect(banner()).toHaveTextContent("daemon runs crew v0.13.0");
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(sockets.opened).toHaveLength(1);
    expect(within(banner()).queryByRole("button", { name: "Fix" })).not.toBeInTheDocument();
    await userEvent.click(within(banner()).getByRole("button", { name: "Reconnect" }));
    expect(sockets.opened).toHaveLength(2);
  });

  it("has no Fix outside the desktop app", () => {
    const { live, sockets } = desktop("#/sessions", true, undefined, slow);
    live();
    sockets.last.drop(1013, "the crew daemon went away");
    expect(within(banner()).queryByRole("button", { name: "Fix" })).not.toBeInTheDocument();
  });

  it("offers Fix in the desktop app while it retries and while it reconnects", async () => {
    const { live, sockets } = desktop("#/sessions", true, undefined, { retryDelay: (n) => (n === 0 ? 5 : 60000), desktopFix: async () => undefined });
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
    const { live, sockets } = desktop("#/sessions", true, undefined, {
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
    const { live, sockets } = desktop("#/sessions", true, undefined, {
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
