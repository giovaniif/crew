import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { EnvInfo } from "../api";
import { desktop } from "../test/desktop";

afterEach(() => {
  window.location.hash = "";
});

const bot = (codex_login: boolean, key: boolean): EnvInfo => ({
  name: "test-bot",
  kind: "custom",
  parts: ["codex"],
  secrets: [{ name: "OPENAI_API_KEY", set: key }],
  used_by: [],
  codex_login,
});

function open(env: EnvInfo) {
  const d = desktop("#/envs/this/test-bot", true, undefined, {}, (s) =>
    s
      .on("GET", "/api/v1/envs", { status: 200, body: { envs: [env] } })
      .on("GET", "/api/v1/envs/test-bot", { status: 200, body: env }),
  );
  d.live();
  return d;
}

describe("the Codex account of a custom environment", () => {
  it("shows a ChatGPT login as logged in with no API key", async () => {
    open(bot(true, false));
    const codex = await screen.findByRole("group", { name: "Codex" });
    const pick = within(codex).getByRole("radiogroup", { name: "Codex login" });
    expect(within(pick).getByRole("radio", { name: "ChatGPT login" })).toHaveAttribute("aria-checked", "true");
    expect(within(codex).getByText("logged in")).toBeInTheDocument();
    expect(within(codex).queryByRole("button", { name: "How to log in" })).not.toBeInTheDocument();
  });

  it("shows how to log in with ChatGPT when there is no login", async () => {
    const user = userEvent.setup();
    open(bot(false, false));
    const codex = await screen.findByRole("group", { name: "Codex" });
    expect(within(codex).getByText("not logged in")).toBeInTheDocument();
    await user.click(within(codex).getByRole("button", { name: "How to log in" }));
    expect(within(codex).getByText("crew env login test-bot --harness codex")).toBeInTheDocument();
  });

  it("selects API key when only the key is set, and the key has Replace", async () => {
    const user = userEvent.setup();
    open(bot(false, true));
    const codex = await screen.findByRole("group", { name: "Codex" });
    expect(within(codex).getByRole("radio", { name: "API key" })).toHaveAttribute("aria-checked", "true");
    expect(within(codex).getByRole("button", { name: "Replace" })).toBeInTheDocument();
    await user.click(within(codex).getByRole("radio", { name: "ChatGPT login" }));
    expect(within(codex).getByText("not logged in")).toBeInTheDocument();
  });
});
