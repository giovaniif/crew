import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { EnvInfo } from "../api";
import { desktop } from "../test/desktop";

afterEach(() => {
  window.location.hash = "";
});

const bot = (pi_login: boolean): EnvInfo => ({
  name: "test-bot",
  kind: "custom",
  parts: ["pi"],
  secrets: [{ name: "ANTHROPIC_API_KEY", set: false }],
  used_by: [],
  pi_login,
});

function open(env: EnvInfo) {
  const d = desktop("#/envs/test-bot", true, undefined, {}, (s) =>
    s
      .on("GET", "/api/v1/envs", { status: 200, body: { envs: [env] } })
      .on("GET", "/api/v1/envs/test-bot", { status: 200, body: env }),
  );
  d.live();
  return d;
}

describe("the Pi account of a custom environment", () => {
  it("shows an omp login as logged in with no How to log in", async () => {
    open(bot(true));
    const pi = await screen.findByRole("group", { name: "Pi" });
    expect(within(pi).getByText("logged in")).toBeInTheDocument();
    expect(within(pi).queryByRole("button", { name: "How to log in" })).not.toBeInTheDocument();
  });

  it("shows not logged in and how to log in when there is no login and no key", async () => {
    const user = userEvent.setup();
    open(bot(false));
    const pi = await screen.findByRole("group", { name: "Pi" });
    expect(within(pi).getByText("not logged in")).toBeInTheDocument();
    await user.click(within(pi).getByRole("button", { name: "How to log in" }));
    expect(within(pi).getByText("crew env login test-bot --harness omp")).toBeInTheDocument();
  });
});
