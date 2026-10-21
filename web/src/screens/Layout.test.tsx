import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { desktop, goldenState, session } from "../test/desktop";

afterEach(() => {
  window.location.hash = "";
});

const tabs = ["Chat", "Terminal", "Review", "Shell", "nvim", "Browser"];

describe("the layout", () => {
  it("shows the sidebar, the toolbar and the main column on a wide screen", () => {
    const { live } = desktop();
    live();
    expect(screen.getByRole("navigation", { name: "Sidebar" })).toBeInTheDocument();
    const toolbar = screen.getByRole("tablist", { name: "Views" });
    expect(within(toolbar).getAllByRole("tab").map((t) => t.textContent)).toEqual(tabs);
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Screens" })).not.toBeInTheDocument();
  });

  it("keeps the phone layout on a narrow screen", () => {
    const { live } = desktop("", false);
    live();
    expect(screen.getByRole("navigation", { name: "Screens" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Sidebar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Views" })).not.toBeInTheDocument();
  });

  it("changes the layout when the window gets wide or narrow", () => {
    const { live, width } = desktop("", false);
    live();
    width.set(true);
    expect(screen.getByRole("navigation", { name: "Sidebar" })).toBeInTheDocument();
    width.set(false);
    expect(screen.queryByRole("navigation", { name: "Sidebar" })).not.toBeInTheDocument();
  });
});

describe("the toolbar", () => {
  it("disables the tabs that need a session and tells why", () => {
    const { live } = desktop();
    live();
    const tab = (name: string) => screen.getByRole("tab", { name });
    expect(tab("Terminal")).toBeEnabled();
    expect(tab("Review")).toBeDisabled();
    expect(tab("Review")).toHaveAccessibleDescription("Start or select a session to review its changes");
    expect(tab("Shell")).toBeDisabled();
    expect(tab("Shell")).toHaveAccessibleDescription("Start or select a session to open a shell in its worktree");
    expect(tab("nvim")).toBeDisabled();
    expect(tab("nvim")).toHaveAccessibleDescription("Start or select a session to open nvim in its worktree");
  });

  it("opens the chat of a selected session and switches to the other tabs", async () => {
    const { live } = desktop();
    live();
    await userEvent.click(screen.getByRole("link", { name: /fix the login redirect/ }));
    expect(window.location.hash).toBe("#/sessions/s1");
    expect(await screen.findByRole("heading", { name: "fix the login redirect" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
    for (const name of ["Review", "Shell", "nvim"]) {
      expect(screen.getByRole("tab", { name })).toBeEnabled();
    }
    await userEvent.click(screen.getByRole("tab", { name: "Review" }));
    expect(screen.getByRole("tab", { name: "Review" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Review" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "fix the login redirect" })).not.toBeInTheDocument();
  });
});

describe("the empty main column", () => {
  it("waits for the daemon before the first state", () => {
    desktop();
    expect(within(screen.getByRole("main")).getByText("Waiting for the daemon")).toBeInTheDocument();
  });

  it("says when there are no sessions", () => {
    const { live } = desktop();
    live({ ...goldenState(), sessions: [] });
    expect(within(screen.getByRole("main")).getByText("No sessions yet")).toBeInTheDocument();
  });

  it("asks to select a session", () => {
    const { live } = desktop();
    live();
    expect(within(screen.getByRole("main")).getByText("Select a session")).toBeInTheDocument();
  });
});

describe("the keys", () => {
  it("selects a session with Ctrl+Shift and a number on Linux and Windows", async () => {
    const { live } = desktop();
    live();
    await userEvent.keyboard("{Control>}2{/Control}");
    expect(window.location.hash).toBe("");
    await userEvent.keyboard("{Control>}{Shift>}2{/Shift}{/Control}");
    expect(window.location.hash).toBe("#/sessions/s2");
  });

  it("selects a session with Cmd and a number on a Mac", async () => {
    const { live } = desktop("", true, "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)");
    live();
    await userEvent.keyboard("{Control>}2{/Control}");
    expect(window.location.hash).toBe("");
    await userEvent.keyboard("{Meta>}1{/Meta}");
    expect(window.location.hash).toBe("#/sessions/s1");
  });

  it("keeps Ctrl+Space for the terminal on Linux and Windows", async () => {
    const { live } = desktop();
    live({ ...goldenState(), sessions: [session("a", "alpha", { State: "permission" })] });
    await userEvent.keyboard("{Control>}[Space]{/Control}");
    expect(window.location.hash).toBe("");
    await userEvent.keyboard("{Control>}{Shift>}[Space]{/Shift}{/Control}");
    expect(window.location.hash).toBe("#/sessions/a");
  });

  it("goes to the next session that needs you with Ctrl+Space on a Mac", async () => {
    const { live } = desktop("", true, "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)");
    live({
      ...goldenState(),
      sessions: [
        session("a", "alpha", { State: "permission" }),
        session("b", "beta"),
        session("c", "gamma", { State: "waiting" }),
      ],
    });
    await userEvent.keyboard("{Control>}[Space]{/Control}");
    expect(window.location.hash).toBe("#/sessions/a");
    await userEvent.keyboard("{Control>}[Space]{/Control}");
    expect(window.location.hash).toBe("#/sessions/c");
    await userEvent.keyboard("{Control>}[Space]{/Control}");
    expect(window.location.hash).toBe("#/sessions/a");
  });

  it("opens New session as a sheet with Ctrl+Shift+N", async () => {
    const { live } = desktop();
    live();
    await userEvent.keyboard("{Control>}n{/Control}");
    expect(screen.queryByRole("dialog", { name: "New session" })).not.toBeInTheDocument();
    await userEvent.keyboard("{Control>}{Shift>}n{/Shift}{/Control}");
    const sheet = await screen.findByRole("dialog", { name: "New session" });
    expect(within(sheet).getByRole("heading", { name: "New session" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Sidebar" })).toBeInTheDocument();
  });

  it("does not use the keys on a narrow screen", async () => {
    const { live } = desktop("", false);
    live();
    await userEvent.keyboard("{Control>}{Shift>}2{/Shift}{/Control}");
    expect(window.location.hash).toBe("");
  });
});
