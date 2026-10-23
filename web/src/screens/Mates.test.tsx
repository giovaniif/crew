import { readFileSync } from "node:fs";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App, type AppEnv, type PageVisibility } from "../App";
import type { Frame, Mates, StreamState } from "../stream";
import { FakeServer, MemoryStorage } from "../test/fake-server";
import { FakeSockets } from "../test/fake-socket";

const golden = (name: string) => JSON.parse(readFileSync(new URL("../../../internal/serve/testdata/" + name, import.meta.url), "utf8"));
const goldenState = (): StreamState => (golden("stream-state.json") as Frame).state as StreamState;
const device = { id: "k3m9p2qx", name: "work phone", created_at: "2026-10-03T10:00:00Z", last_seen: "2026-10-03T10:00:00Z" };

const board: Mates = {
  stopped: false,
  mates: [
    {
      name: "helper",
      state: "connected",
      work: ["s1"],
      threads: [
        {
          mate: "helper",
          team: "T1",
          channel: "C1",
          thread_ts: "1700.0001",
          session_id: "s1",
          url: "https://app.slack.com/client/T1/C1/thread/C1-1700.0001",
          session: "add login",
          state: "running",
          ended: false,
        },
      ],
      conversations: [],
    },
    { name: "webby", state: "paused", work: [], threads: [], conversations: [{ session: "s2", name: "fix the docs", state: "waiting", ended: false, started_at: "2026-10-03T11:00:00Z" }] },
    { name: "fresh", state: "ready", work: [], threads: [], conversations: [] },
  ],
};

const defs = {
  mates: [
    { name: "helper", prompt: "Help.\nWith care.\n\nMore help.", agent: "claude", model: "opus", effort: "high", repos: ["api"], avatar: "owl", enabled: true },
    { name: "webby", prompt: "Web.", agent: "codex", enabled: false },
    { name: "fresh", prompt: "New.", agent: "claude", enabled: true },
  ],
  limits: { hop_limit: 5, turns_per_hour: 20, daily_turns: 100, daily_tokens: 0, stop: false },
  tones: [
    { key: "terse", low: "Brief", high: "Wordy", steps: ["Say almost nothing.", "Write one line per answer.", "", "Say more.", "Say all of it."] },
    { key: "cautious", low: "Cautious", high: "Bold", steps: ["C1.", "C2.", "", "C4.", "C5."] },
    { key: "formal", low: "Formal", high: "Playful", steps: ["F1.", "F2.", "", "F4.", "F5."] },
  ],
};

const chat = [
  { id: "u1", cursor: 1, turn: "p1", role: "user", text: "Fix the docs", at: "2026-10-03T11:00:00Z" },
  { id: "a1", cursor: 2, turn: "p1", role: "assistant", text: "I fixed the docs.", at: "2026-10-03T11:01:00Z" },
];

function setup(hash = "#/mates", mates: Mates = board, approvals: unknown[] = [], visibility?: PageVisibility) {
  window.location.hash = "";
  const sockets = new FakeSockets();
  const server = new FakeServer()
    .on("GET", "/api/v1/hello", { status: 200, body: { api: "v1", build: "v0.12.0+abc" } })
    .on("GET", "/api/v1/workspaces", { status: 200, body: { workspaces: [], last_used: "" } })
    .on("GET", "/api/v1/mates", { status: 200, body: defs })
    .on("GET", "/api/v1/approvals", { status: 200, body: approvals })
    .on("POST", "/api/v1/mates/stop", { status: 200, body: defs.limits })
    .on("POST", "/api/v1/mates/helper/pause", { status: 200, body: defs.mates[0] })
    .on("POST", "/api/v1/mates/webby/resume", { status: 200, body: defs.mates[1] })
    .on("POST", "/api/v1/mates", { status: 200, body: { name: "scout", prompt: "Scout.", agent: "codex", enabled: true } })
    .on("POST", "/api/v1/mates/helper/new", { status: 200, body: { ID: "s9" } })
    .on("POST", "/api/v1/mates/webby/new", { status: 200, body: { ID: "s8" } })
    .on("POST", "/api/v1/sessions/s2/fresh", { status: 200, body: { ID: "s8" } })
    .on("POST", "/api/v1/sessions/s2/messages", { status: 200, body: { queued: false } })
    .on("GET", "/api/v1/sessions/s2/messages?limit=50", { status: 200, body: { messages: chat, before: 0 } })
    .on("GET", "/api/v1/sessions/s1/messages?limit=50", { status: 200, body: { messages: chat, before: 0 } })
    .on("GET", "/api/v1/mates/helper/memory", { status: 200, body: { name: "helper", path: "/m/helper/memory.md", text: "- Tests come first.", limit: 8192 } })
    .on("POST", "/api/v1/mates/helper/memory", { status: 200, body: { name: "helper", path: "/m/helper/memory.md", text: "- Small PRs.", limit: 8192 } })
    .on("GET", "/api/v1/mates/fresh/setup", { status: 200, body: { manifest: "{}", url: "https://api.slack.com/apps?new_app=1" } });
  const storage = new MemoryStorage();
  storage.setItem("crew.auth", JSON.stringify({ token: "t0k", device }));
  const env: AppEnv = {
    fetch: server.fetch,
    storage,
    installed: true,
    hash,
    host: "crew.example.ts.net",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    openStream: sockets.open,
    now: () => Date.parse("2026-10-03T12:00:00Z"),
    onHashChange: () => () => undefined,
    visibility,
  };
  render(<App env={env} />);
  sockets.last.open();
  const st = goldenState();
  st.sessions = st.sessions.map((x) => (x.ID === "s2" ? { ...x, Mate: { Name: "webby", Local: true } } : x));
  sockets.last.push({ state: { ...st, mates } });
  return { server, sockets };
}

const calls = (server: FakeServer) => server.calls.map((c) => c.method + " " + c.path);

describe("Mates", () => {
  it("is a tab", () => {
    setup("");
    expect(screen.getByRole("link", { name: "Mates" })).toHaveAttribute("href", "#/mates");
  });

  it("lists each mate as a row with its face, its name and persona · agent, linked to its profile", async () => {
    setup();
    const helper = await screen.findByRole("link", { name: "helper, Working on add login" });
    expect(helper).toHaveAttribute("href", "#/mates/helper");
    expect(await within(helper).findByRole("img", { name: "Owl working" })).toBeInTheDocument();
    expect(within(helper).getByText("Help. With care. · Claude")).toBeInTheDocument();
    expect(helper).not.toHaveTextContent("More help.");
    const webby = screen.getByRole("link", { name: "webby, Paused" });
    expect(within(webby).getByText("paused")).toBeInTheDocument();
    expect(within(webby).getByText("Web. · Codex")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "fresh, Idle" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New mate" })).toHaveAttribute("href", "#/mates/new");
  });

  it("shows the profile of the first mate next to the list, and marks its row", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "helper" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^helper,/ })).toHaveAttribute("aria-current", "page");
  });

  it("filters the mates by agent with All, Claude and Codex", async () => {
    setup();
    const sources = await screen.findByRole("radiogroup", { name: "Mate sources" });
    await screen.findByText("Help. With care. · Claude");
    expect(within(sources).getByRole("radio", { name: "All" })).toHaveAttribute("aria-checked", "true");
    await userEvent.setup().click(within(sources).getByRole("radio", { name: "Codex" }));
    const all = screen.getByRole("list", { name: "All mates" });
    expect(within(all).getByRole("link", { name: /^webby/ })).toBeInTheDocument();
    expect(within(all).queryByRole("link", { name: /^helper/ })).toBeNull();
    expect(within(all).queryByRole("link", { name: /^fresh/ })).toBeNull();
  });

  it("searches the mates by name and by the first paragraph of the prompt", async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByText("Help. With care. · Claude");
    const all = () => screen.getByRole("list", { name: "All mates" });
    await user.type(screen.getByRole("searchbox", { name: "Search mates" }), "web");
    expect(within(all()).getByRole("link", { name: /^webby/ })).toBeInTheDocument();
    expect(within(all()).queryByRole("link", { name: /^helper/ })).toBeNull();
    await user.clear(screen.getByRole("searchbox", { name: "Search mates" }));
    await user.type(screen.getByRole("searchbox", { name: "Search mates" }), "zzz");
    expect(screen.getByText("No mate matches.")).toBeInTheDocument();
  });

  it("puts a mate with a pending approval in the Needs you group", async () => {
    const ask = {
      ID: "a1",
      SessionID: "s1",
      Mate: "helper",
      Requester: "Gus",
      Action: { Kind: "merge", Tool: "Bash", Input: "gh pr merge 1" },
      At: "2026-10-03T11:00:00Z",
      State: "pending",
    };
    setup("#/mates", board, [ask]);
    const needs = await screen.findByRole("list", { name: "Needs you" });
    const helper = await within(needs).findByRole("link", { name: "helper, Needs you" });
    expect(within(helper).getByRole("img", { name: "Owl needs" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "All mates" })).queryByRole("link", { name: /^helper/ })).toBeNull();
  });

  it("stops all mates only after a confirm", async () => {
    const { server } = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Stop all" }));
    const ask = screen.getByRole("dialog", { name: "Stop all mates?" });
    expect(ask).toHaveTextContent("They start no new turns until you start them again.");
    expect(server.calls.some((c) => c.path === "/api/v1/mates/stop")).toBe(false);
    await user.click(within(ask).getByRole("button", { name: "Stop all" }));
    await waitFor(() => expect(server.calls.find((c) => c.path === "/api/v1/mates/stop")?.body).toEqual({ stop: true }));
  });

  it("shows the stop from the stream on the Mates page and on the session list, and starts the mates again", async () => {
    const { server, sockets } = setup();
    sockets.last.push({ diff: { seq: 99, mates: { ...board, stopped: true } } });
    const user = userEvent.setup();
    expect(await screen.findByText("All mates are stopped.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start all mates" }));
    await waitFor(() => expect(server.calls.find((c) => c.path === "/api/v1/mates/stop")?.body).toEqual({ stop: false }));
  });

  it("shows a stopped banner over the session list", async () => {
    setup("", { ...board, stopped: true });
    expect(await screen.findByRole("status")).toHaveTextContent("All mates are stopped");
  });
});

describe("Mate profile", () => {
  it("shows the face, the fact cards, the threads and the memory", async () => {
    setup("#/mates/helper");
    expect(await screen.findByRole("heading", { name: "helper" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^helper,/ })).toHaveAttribute("aria-current", "page");
    expect((await screen.findAllByRole("img", { name: "Owl working" })).length).toBe(2);
    expect(screen.getByRole("group", { name: "Agent" })).toHaveTextContent("Claude · opus");
    expect(screen.getByRole("group", { name: "Agent" })).toHaveTextContent("effort high");
    expect(screen.getByRole("group", { name: "Repos" })).toHaveTextContent("api");
    expect(screen.getByRole("group", { name: "Slack" })).toHaveTextContent("Connected");
    await waitFor(() => expect(screen.getByRole("group", { name: "Memory" })).toHaveTextContent("19 bytes of 8 KB"));
    const list = screen.getByRole("list", { name: "Conversations of helper" });
    expect(within(list).getByRole("link", { name: /add login/ })).toHaveAttribute("href", "#/sessions/s1");
    expect(within(list).getByRole("link", { name: "Slack" })).toHaveAttribute("href", "https://app.slack.com/client/T1/C1/thread/C1-1700.0001");
    expect(await screen.findByText("- Tests come first.")).toBeInTheDocument();
  });

  it("lists the local conversations and resumes a paused mate", async () => {
    const { server } = setup("#/mates/webby");
    const list = await screen.findByRole("list", { name: "Conversations of webby" });
    expect(within(list).getByRole("link", { name: /fix the docs/ })).toHaveAttribute("href", "#/sessions/s2");
    await userEvent.setup().click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(calls(server)).toContain("POST /api/v1/mates/webby/resume"));
  });

  it("pauses a mate", async () => {
    const { server } = setup("#/mates/helper");
    await userEvent.setup().click(await screen.findByRole("button", { name: "Pause" }));
    await waitFor(() => expect(calls(server)).toContain("POST /api/v1/mates/helper/pause"));
  });

  it("starts a new conversation and opens it", async () => {
    const { server } = setup("#/mates/helper");
    await userEvent.setup().click(await screen.findByRole("button", { name: "+ New conversation" }));
    await waitFor(() => expect(window.location.hash).toBe("#/sessions/s9"));
    expect(calls(server)).toContain("POST /api/v1/mates/helper/new");
  });

  it("says there is no such mate next to the list", async () => {
    setup("#/mates/ghost");
    expect(await screen.findByText("There is no mate ghost.")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "All mates" })).toBeInTheDocument();
  });

  it("shows a failed new conversation next to its button, not under the page", async () => {
    const { server } = setup("#/mates/helper");
    server.on("POST", "/api/v1/mates/helper/new", { status: 400, body: { error: { code: "bad_request", message: "no workspace to start in" } } });
    await userEvent.setup().click(await screen.findByRole("button", { name: "+ New conversation" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("no workspace to start in");
    expect(screen.getByRole("button", { name: "+ New conversation" }).nextElementSibling).toBe(alert);
  });

  it("edits the memory", async () => {
    const { server } = setup("#/mates/helper");
    const user = userEvent.setup();
    await screen.findByText("- Tests come first.");
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const box = screen.getByLabelText("Memory of helper");
    await user.clear(box);
    await user.type(box, "- Small PRs.");
    await user.click(screen.getByRole("button", { name: "Save memory" }));
    expect(await screen.findByText("- Small PRs.")).toBeInTheDocument();
    expect(server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/mates/helper/memory")?.body).toEqual({ text: "- Small PRs." });
  });

  it("shows the memory meter, the size against the limit", async () => {
    setup("#/mates/helper");
    const meter = await screen.findByRole("meter", { name: "Memory size" });
    await waitFor(() => expect(meter).toHaveAttribute("aria-valuenow", "19"));
    expect(meter).toHaveAttribute("aria-valuemax", "8192");
    expect(screen.getByText("19 bytes of 8 KB")).toBeInTheDocument();
  });

  it("clears the memory only after a confirm", async () => {
    const { server } = setup("#/mates/helper");
    const user = userEvent.setup();
    await screen.findByText("- Tests come first.");
    await user.click(screen.getByRole("button", { name: "Clear…" }));
    const ask = screen.getByRole("dialog", { name: "Clear the memory of helper?" });
    expect(server.calls.some((c) => c.method === "POST" && c.path === "/api/v1/mates/helper/memory")).toBe(false);
    await user.click(within(ask).getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/mates/helper/memory")?.body).toEqual({ text: "" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the memory when the owner cancels Clear memory", async () => {
    const { server } = setup("#/mates/helper");
    const user = userEvent.setup();
    await screen.findByText("- Tests come first.");
    await user.click(screen.getByRole("button", { name: "Clear…" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(server.calls.some((c) => c.method === "POST" && c.path === "/api/v1/mates/helper/memory")).toBe(false);
  });

  it("offers Connect… in the Slack card for a mate without Slack", async () => {
    setup("#/mates/fresh");
    const user = userEvent.setup();
    const card = await screen.findByRole("group", { name: "Slack" });
    expect(card).toHaveTextContent("Not connected");
    expect(within(card).getByRole("img", { name: "Slack" })).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Connect…" }));
    expect(await screen.findByRole("link", { name: "Make the Slack app from the manifest" })).toHaveAttribute(
      "href",
      "https://api.slack.com/apps?new_app=1",
    );
  });

  it("does not offer Slack to a connected mate", async () => {
    setup("#/mates/helper");
    await screen.findByRole("heading", { name: "helper" });
    expect(screen.queryByRole("button", { name: "Connect…" })).toBeNull();
  });
});

describe("New mate", () => {
  it("makes a mate in four steps: face, personality with tone, brains, meet", async () => {
    const { server } = setup("#/mates/new");
    const user = userEvent.setup();
    expect(await screen.findByLabelText("Step 1 of 4")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Quill" }));
    expect(screen.getByRole("button", { name: "Quill" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Color #209fb5" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "scout");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(screen.getByLabelText("Prompt"), "Scout the repo.");
    expect(screen.getByRole("region", { name: "Added to the prompt" })).toHaveTextContent("Middle step. Adds no text.");
    const brief = screen.getByRole("slider", { name: "Brief to Wordy" });
    expect(brief.tagName).not.toBe("INPUT");
    brief.focus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getAllByText("Brief 2/5").length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: "Added to the prompt" })).toHaveTextContent("Write one line per answer.");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(within(screen.getByRole("radiogroup", { name: "Agent" })).getByRole("radio", { name: "Codex" }));
    await user.type(screen.getByLabelText("Model"), "gpt-5");
    await user.type(screen.getByLabelText("Effort"), "high");
    await user.type(screen.getByLabelText("Repos"), "api, web");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByLabelText("Step 4 of 4")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Meet scout" })).toBeInTheDocument();
    const facts = screen.getByRole("region", { name: "About scout" });
    expect(facts).toHaveTextContent("Codex · gpt-5 · high");
    expect(facts).toHaveTextContent("api, web");
    expect(server.calls.some((c) => c.method === "POST" && c.path === "/api/v1/mates")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/mates")?.body).toEqual({
        mate: {
          name: "scout",
          prompt: "Scout the repo.",
          tone: { terse: 2, cautious: 3, formal: 3 },
          agent: "codex",
          model: "gpt-5",
          effort: "high",
          repos: ["api", "web"],
          avatar: "quill",
          color: "#209fb5",
          enabled: true,
        },
      }),
    );
    await waitFor(() => expect(window.location.hash).toBe("#/mates/scout"));
  });

  it("takes the name of the chosen face until the user types a name, as the Mac app does", async () => {
    setup("#/mates/new");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Quill" }));
    expect(screen.getByLabelText("Name")).toHaveValue("quill");
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Owl" }));
    expect(screen.getByLabelText("Name")).toHaveValue("owl");
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "scout");
    await user.click(screen.getByRole("button", { name: "Bolt" }));
    expect(screen.getByLabelText("Name")).toHaveValue("scout");
  });

  it("has Cancel back to the mates, a 4-step progress bar and preset cards that fill the prompt", async () => {
    setup("#/mates/new");
    const user = userEvent.setup();
    expect(await screen.findByRole("link", { name: "Cancel" })).toHaveAttribute("href", "#/mates");
    expect(screen.getByRole("progressbar", { name: "Step 1 of 4" })).toHaveAttribute("aria-valuenow", "1");
    await user.type(screen.getByLabelText("Name"), "scout");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "How should scout work?" })).toBeInTheDocument();
    const presets = screen.getByRole("radiogroup", { name: "Presets" });
    await user.click(within(presets).getByRole("radio", { name: /^Fast bug fixer/ }));
    expect(within(presets).getByRole("radio", { name: /^Fast bug fixer/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Prompt")).toHaveValue("You fix bugs fast. Make the smallest diff that makes the test pass.");
  });

  it("goes back a step and keeps the choices", async () => {
    setup("#/mates/new");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "scout");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Name")).toHaveValue("scout");
  });

  it("refuses the name of a mate that exists, so Create cannot replace it", async () => {
    setup("#/mates/new");
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Quill" });
    await user.type(screen.getByLabelText("Name"), "helper");
    expect(await screen.findByText("A mate named helper exists.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("refuses a name that is not a mate handle", async () => {
    setup("#/mates/new");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "scout.dev");
    expect(screen.getByText("Use up to 32 letters, digits, - and _.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("needs a prompt before brains, even with a tone set", async () => {
    setup("#/mates/new");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "scout");
    await user.click(screen.getByRole("button", { name: "Next" }));
    const slider = (await screen.findAllByRole("slider"))[0];
    slider.focus();
    await user.keyboard("{Home}");
    expect(screen.getByText("Write a personality prompt or pick a preset.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await user.type(screen.getByLabelText("Prompt"), "Pair programmer.");
    expect(screen.queryByText("Write a personality prompt or pick a preset.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });
});

describe("Mate conversation", () => {
  it("shows the face of the mate in the toolbar, linked to the profile", async () => {
    setup("#/sessions/s2");
    const bar = await screen.findByRole("toolbar", { name: "Session" });
    const who = within(bar).getByRole("link", { name: /^webby/ });
    expect(who).toHaveAttribute("href", "#/mates/webby");
    expect(within(who).getByRole("img", { name: /paused$/ })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Start fresh" })).toBeInTheDocument();
  });

  it("asks before it starts fresh, and starts nothing on Cancel", async () => {
    const { server } = setup("#/sessions/s2");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Start fresh" }));
    const ask = screen.getByRole("dialog", { name: "Start fresh with Webby?" });
    expect(ask).toHaveTextContent("Webby writes a handoff to memory");
    await user.click(within(ask).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls(server)).not.toContain("POST /api/v1/sessions/s2/fresh");
  });

  it("starts fresh with mate.fresh in the same worktree", async () => {
    const { server } = setup("#/sessions/s2");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Start fresh" }));
    const ask = screen.getByRole("dialog");
    expect(within(ask).getByRole("checkbox", { name: "Keep this worktree" })).toBeChecked();
    await user.click(within(ask).getByRole("button", { name: "Start fresh" }));
    await waitFor(() => expect(window.location.hash).toBe("#/sessions/s8"));
    expect(calls(server).filter((c) => c.startsWith("POST") && !c.endsWith("/read"))).toEqual(["POST /api/v1/sessions/s2/fresh"]);
    expect(calls(server)).toContain("POST /api/v1/sessions/s2/read");
    expect(server.calls.find((c) => c.path === "/api/v1/sessions/s2/fresh")?.body).toEqual({ same_worktree: true });
  });

  it("starts fresh in a new worktree when the owner clears Keep this worktree", async () => {
    const { server } = setup("#/sessions/s2");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Start fresh" }));
    const ask = screen.getByRole("dialog");
    await user.click(within(ask).getByRole("checkbox", { name: "Keep this worktree" }));
    await user.click(within(ask).getByRole("button", { name: "Start fresh" }));
    await waitFor(() => expect(window.location.hash).toBe("#/sessions/s8"));
    expect(server.calls.find((c) => c.path === "/api/v1/sessions/s2/fresh")?.body).toEqual({ same_worktree: false });
  });

  it("shows the name and face of the mate on each message of the mate", async () => {
    setup("#/sessions/s2");
    const log = within(await screen.findByRole("log", { name: "Messages" }));
    const reply = await log.findByRole("article", { name: "Webby" });
    expect(within(reply).getByText("I fixed the docs.")).toBeInTheDocument();
    expect(within(reply).getByText("Webby")).toBeInTheDocument();
    expect(within(reply).getByRole("img", { name: /paused$/ })).toBeInTheDocument();
    expect(log.queryByRole("article", { name: "You" })).toBeNull();
  });

  it("asks you to message the mate by name", async () => {
    setup("#/sessions/s2");
    expect(await screen.findByRole("textbox", { name: "Message" })).toHaveAttribute("placeholder", "Message Webby…");
  });

  it("shows no face on a session of no mate", async () => {
    setup("#/sessions/s1");
    const log = within(await screen.findByRole("log", { name: "Messages" }));
    expect(await log.findByText("I fixed the docs.")).toBeInTheDocument();
    expect(log.queryByRole("article")).toBeNull();
    expect(log.queryByRole("img")).toBeNull();
  });

  it("has no Start fresh on a session of no mate", async () => {
    setup("#/sessions/s1");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: "Start fresh" })).toBeNull();
  });
});
