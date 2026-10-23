import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { Mates } from "../stream";
import type { FakeServer } from "../test/fake-server";
import { desktop, goldenState } from "../test/desktop";

afterEach(() => {
  window.location.hash = "";
});

const board: Mates = {
  stopped: false,
  mates: [
    { name: "ada", state: "connected", work: [], threads: [], conversations: [{ session: "s1", name: "review 42", state: "running", ended: false, started_at: "2026-10-03T12:30:00Z" }] },
    { name: "rex", state: "connected", work: [], threads: [], conversations: [] },
    { name: "june", state: "paused", work: [], threads: [], conversations: [] },
  ],
};

const defs = {
  mates: [
    { name: "ada", prompt: "Careful reviewer", agent: "claude", enabled: true },
    { name: "rex", prompt: "Release helper", agent: "codex", env: "test-work", enabled: true },
    { name: "june", prompt: "Patient explainer", agent: "omp", enabled: true },
  ],
  tones: [],
};

const ask = { ID: "ap1", SessionID: "s9", Mate: "rex", Requester: "U1", Action: { Kind: "push", Tool: "Bash", Input: "git push --tags" }, At: "2026-10-03T12:26:00Z", State: "pending" };

const routes = (server: FakeServer) => {
  server
    .on("GET", "/api/v1/mates", { status: 200, body: defs })
    .on("GET", "/api/v1/approvals", { status: 200, body: [ask] })
    .on("GET", "/api/v1/envs", {
      status: 200,
      body: {
        envs: [
          { name: "local", kind: "local", parts: [], secrets: [], used_by: ["ada", "june"] },
          { name: "test-work", kind: "custom", parts: [], secrets: [], used_by: ["rex"] },
        ],
      },
    })
    .on("POST", "/api/v1/approvals/ap1/approve", { status: 200, body: { ...ask, State: "granted" } });
};

function home(hash = "", wide = true) {
  const out = desktop(hash, wide, undefined, {}, routes);
  out.live({ ...goldenState(), mates: board });
  return out;
}

const cardNames = () => screen.getAllByRole("article").map((a) => within(a).getByRole("heading").textContent);

describe("the Mates home", () => {
  it("is the default screen on the desktop, with the nav in the frame order", async () => {
    home();
    expect(await screen.findByRole("heading", { name: "Mates", level: 1 })).toBeInTheDocument();
    const nav = within(screen.getByRole("navigation", { name: "Sidebar" }));
    expect(nav.getAllByRole("link").map((a) => a.getAttribute("aria-label") ?? a.querySelector(".nm")?.textContent)).toEqual(
      expect.arrayContaining(["Mates", "Sessions", "Approvals", "Automations", "Environments", "Disk", "Settings"]),
    );
    const order = nav.getAllByRole("link").map((a) => a.querySelector(".nm")?.textContent).filter(Boolean);
    expect(order).toEqual(["Mates", "Sessions", "Approvals", "Automations", "Environments", "Disk", "Settings"]);
    expect(nav.getByRole("link", { name: /^Mates/ })).toHaveAttribute("aria-current", "page");
    expect(nav.getByRole("link", { name: /^Sessions/ })).toHaveAttribute("href", "#/sessions");
    expect(nav.getByRole("link", { name: "+ New mate" })).toHaveAttribute("href", "#/mates/new");
  });

  it("shows the real environment badge: Local grey, Custom blue", async () => {
    home();
    await screen.findByText("Asks: git push --tags");
    const rex = within(screen.getAllByRole("article")[0]);
    expect(await rex.findByText("test-work")).toHaveClass("envb", "custom");
    expect(within(screen.getAllByRole("article")[1]).getByText("Local")).toHaveClass("envb", "local");
  });

  it("filters by environment", async () => {
    home();
    await screen.findByText("Asks: git push --tags");
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Environment" }));
    await user.click(await screen.findByRole("option", { name: "test-work" }));
    expect(cardNames()).toEqual(["rex"]);
  });

  it("shows the needs-you mate first, with the summary, the harness tag and the Local badge", async () => {
    home();
    await screen.findByText("Asks: git push --tags");
    expect(cardNames()).toEqual(["rex", "ada", "june"]);
    expect(screen.getByText("3 mates · 1 working")).toBeInTheDocument();
    const rex = within(screen.getAllByRole("article")[0]);
    expect(rex.getByText("needs you")).toBeInTheDocument();
    expect(rex.getByText("Codex")).toBeInTheDocument();
    expect(rex.getByText("Release helper")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Needs you" })).toHaveTextContent("rex waits for your answer.");
    expect(screen.getByRole("link", { name: "Open thread" })).toHaveAttribute("href", "#/sessions/s9");
    expect(screen.queryByRole("button", { name: /Stop all/ })).not.toBeInTheDocument();
  });

  it("approves from the card", async () => {
    const { server } = home();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Approve" }));
    expect(server.calls.map((c) => c.method + " " + c.path)).toContain("POST /api/v1/approvals/ap1/approve");
  });

  it("filters by harness", async () => {
    home();
    await screen.findByText("Asks: git push --tags");
    await userEvent.setup().click(screen.getByRole("radio", { name: "Pi" }));
    expect(cardNames()).toEqual(["june"]);
  });

  it("lists the recent activity", async () => {
    home();
    const recent = within(await screen.findByRole("list", { name: "Recent activity" }));
    expect(recent.getByText("started “review 42”")).toBeInTheDocument();
  });

  it("keeps the session list at #/sessions", () => {
    home("#/sessions");
    expect(screen.getByRole("heading", { name: "Sessions", level: 1 })).toBeInTheDocument();
  });

  it("is the default screen on the phone, with the tabs Mates, Sessions, Approvals and More", async () => {
    home("", false);
    expect(await screen.findByRole("heading", { name: "Mates", level: 1 })).toBeInTheDocument();
    const tabs = within(screen.getByRole("navigation", { name: "Screens" }));
    expect(tabs.getAllByRole("link").map((a) => a.textContent?.slice(1))).toEqual(["Mates", "Sessions", "Approvals", "More"]);
    expect(tabs.getByRole("link", { name: "Mates" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "rex waits for you" })).toHaveAttribute("href", "#/sessions/s9");
  });

  it("holds Automations, Disk and Settings under More on the phone", () => {
    home("#/more", false);
    const tabs = within(screen.getByRole("navigation", { name: "Screens" }));
    expect(tabs.getByRole("link", { name: "More" })).toHaveAttribute("aria-current", "page");
    for (const [name, href] of [
      ["Automations", "#/automations"],
      ["Disk", "#/disk"],
      ["Settings", "#/settings"],
    ]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });
});
