import { readFileSync } from "node:fs";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { StreamState } from "../stream";
import { desktop, goldenState, session } from "../test/desktop";

const disk = JSON.parse(readFileSync(new URL("../../../internal/serve/testdata/" + "disk.json", import.meta.url), "utf8"));

afterEach(() => {
  window.location.hash = "";
});

function state(): StreamState {
  const base = goldenState();
  return {
    ...base,
    sessions: [session("s1", "fix the login redirect")],
    worktrees: [
      { ID: "w1", Repo: "api", Path: "/w/api-feat", Branch: "feat", PR: null, SubtaskSlug: "", SessionID: "s1", Ports: null },
      { ID: "w2", Repo: "web", Path: "/w/web-old", Branch: "old", PR: null, SubtaskSlug: "", SessionID: "", Ports: null },
    ],
  };
}

function open(wide = true) {
  const d = desktop("#/disk", wide, undefined, {}, (server) => server.on("GET", "/api/v1/disk", { status: 200, body: disk }));
  d.live(state());
  return d;
}

const row = (name: RegExp) => screen.findByRole("row", { name });

describe("the disk window", () => {
  it("is a link in the sidebar", () => {
    const { live } = desktop();
    live();
    expect(within(screen.getByRole("navigation", { name: "Sidebar" })).getByRole("link", { name: "Disk" })).toHaveAttribute("href", "#/disk");
  });

  it("shows the stat cards, the tabs with counts and a row for each worktree with its state pill and what cleanup does", async () => {
    open();
    const cards = await screen.findByRole("list", { name: "Disk" });
    expect(within(cards).getAllByRole("listitem")).toHaveLength(5);
    expect(cards).toHaveTextContent("61 GB free");
    expect(cards).toHaveTextContent("88%");
    expect(cards).toHaveTextContent("On · every 10m");
    expect(cards).toHaveTextContent("3.1 GB");
    expect(within(cards).getByRole("meter", { name: "Volume used" })).toHaveAttribute("aria-valuenow", "88");
    expect(screen.getByRole("heading", { name: "Worktrees and disk" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Worktrees 2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Dev servers 1" })).toBeInTheDocument();
    const kept = await row(/api-feat/);
    expect(kept).toHaveTextContent("fix the login redirect");
    expect(within(kept).getByText("No PR")).toHaveClass("pill");
    expect(kept).toHaveTextContent("kept: its session is live");
    expect(kept).toHaveTextContent(":5173");
    expect(within(kept).queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
    const merged = await row(/web-old/);
    expect(within(merged).getByText("Merged · clean")).toHaveClass("pill", "ok");
    expect(merged).toHaveTextContent("…");
  });

  it("asks before Clean up now and shows what it cleaned", async () => {
    const { server } = open();
    server.on("POST", "/api/v1/cleanup/run", { status: 200, body: { items: [{ path: "/w/web-old", branch: "old", action: "remove", reason: "PR #77 merged", outcome: "removed" }] } });
    await userEvent.click(await screen.findByRole("button", { name: "Clean up now" }));
    const dialog = screen.getByRole("dialog", { name: "Clean up now" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(server.calls.some((c) => c.path === "/api/v1/cleanup/run")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Clean up now" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Clean up now" })).getByRole("button", { name: "Clean up" }));
    expect(server.calls.some((c) => c.method === "POST" && c.path === "/api/v1/cleanup/run")).toBe(true);
    expect(await screen.findByRole("status")).toHaveTextContent("Cleaned 1 worktree");
  });

  it("asks before it removes a worktree and sends nothing on Cancel", async () => {
    const { server } = open();
    server.on("POST", "/api/v1/cleanup/worktree", { status: 200, body: { path: "/w/web-old", branch: "old", action: "remove", reason: "PR #77 merged", outcome: "removed" } });
    await userEvent.click(within(await row(/web-old/)).getByRole("button", { name: "Remove…" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Remove web-old? It goes to the crew trash; the branch stays.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(server.calls.some((c) => c.path === "/api/v1/cleanup/worktree")).toBe(false);
    await userEvent.click(within(await row(/web-old/)).getByRole("button", { name: "Remove…" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }));
    expect(server.calls.find((c) => c.path === "/api/v1/cleanup/worktree")?.body).toEqual({ path: "/w/web-old", backup: false });
    expect(await screen.findByRole("status")).toHaveTextContent("web-old: removed");
  });

  it("shows why the server refused a cleanup", async () => {
    const { server } = open();
    server.on("POST", "/api/v1/cleanup/worktree", { status: 403, body: { error: { code: "forbidden", message: "only the owner device can do this" } } });
    await userEvent.click(within(await row(/web-old/)).getByRole("button", { name: "Remove…" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("only the owner device can do this");
  });

  it("goes to the session and opens a shell in the main window", async () => {
    const { server } = open();
    server.on("POST", "/api/v1/sessions/s1/shell", { status: 200, body: { pane: "%9", dir: "/w/api-feat", shown: true } });
    await userEvent.click(within(await row(/api-feat/)).getByRole("button", { name: "Go to session" }));
    expect(window.location.hash).toBe("#/sessions/s1");
    window.location.hash = "#/disk";
    await userEvent.click(within(await row(/api-feat/)).getByRole("button", { name: "Open shell" }));
    expect(server.calls.find((c) => c.path === "/api/v1/sessions/s1/shell")?.body).toEqual({ worktree: "/w/api-feat" });
    expect(window.location.hash).toBe("#/sessions/s1/shell");
    expect(await screen.findByRole("tab", { name: "Shell" })).toHaveAttribute("aria-selected", "true");
  });

  it("lists the ports and asks before it kills a dev server", async () => {
    const { server } = open();
    server.on("POST", "/api/v1/ports/kill", { status: 200, body: { killed: [40] } });
    await userEvent.click(await screen.findByRole("tab", { name: "Dev servers 1" }));
    const port = await row(/:5173/);
    expect(port).toHaveTextContent("node");
    expect(port).toHaveTextContent("api-feat");
    await userEvent.click(within(port).getByRole("button", { name: "Stop…" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Stop the dev server on :5173 in api-feat?");
    await userEvent.click(within(dialog).getByRole("button", { name: "Stop" }));
    expect(server.calls.find((c) => c.path === "/api/v1/ports/kill")?.body).toEqual({ pgids: [40] });
  });

  it("lists the recent cleanups", async () => {
    open();
    await userEvent.click(await screen.findByRole("tab", { name: "Recently cleaned" }));
    const recent = await row(/api-old/);
    expect(recent).toHaveTextContent("old");
    expect(recent).toHaveTextContent("removed");
  });

  it("works in the phone layout", async () => {
    open(false);
    expect(await row(/api-feat/)).toBeInTheDocument();
  });
});
