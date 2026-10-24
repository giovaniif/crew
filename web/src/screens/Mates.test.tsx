import { readFileSync } from "node:fs";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App, type AppEnv, type PageVisibility } from "../App";
import type { Frame, Mates, StreamState } from "../stream";
import { FakeServer, MemoryStorage } from "../test/fake-server";
import { FakeSockets } from "../test/fake-socket";
import { FakeWidth } from "../test/fake-width";

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
      channels: ["api", "web"],
    },
    {
      name: "webby",
      state: "paused",
      work: [],
      threads: [],
      conversations: [
        { session: "s2", name: "fix the docs", state: "waiting", ended: false, started_at: "2026-10-03T11:00:00Z" },
        { session: "s7", name: "weekly deps", state: "idle", ended: false, started_at: "2026-10-03T10:00:00Z", automation: "test-weekly" },
      ],
    },
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

function setup(hash = "#/mates/helper", mates: Mates = board, approvals: unknown[] = [], visibility?: PageVisibility, wide = false) {
  window.location.hash = "";
  const sockets = new FakeSockets();
  const server = new FakeServer()
    .on("GET", "/api/v1/hello", { status: 200, body: { api: "v1", build: "v0.12.0+abc" } })
    .on("GET", "/api/v1/workspaces", { status: 200, body: { workspaces: [], last_used: "" } })
    .on("GET", "/api/v1/mates", { status: 200, body: defs })
    .on("GET", "/api/v1/approvals", { status: 200, body: approvals })
    .on("GET", "/api/v1/automations", {
      status: 200,
      body: {
        automations: [
          { name: "test-weekly", agent: "claude", mate: "helper", schedule: "weekly mon 09:00", prompt: "TEST", enabled: true, source: "/h/config.toml" },
          { name: "test-solo", agent: "claude", prompt: "TEST", enabled: true, source: "/h/config.toml" },
        ],
      },
    })
    .on("GET", "/api/v1/envs", {
      status: 200,
      body: {
        envs: [
          { name: "local", kind: "local", parts: [], secrets: [], used_by: ["helper"] },
          { name: "test-work", kind: "custom", parts: ["github"], secrets: [], used_by: [] },
        ],
      },
    })
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
    wide: new FakeWidth(wide),
  };
  render(<App env={env} />);
  sockets.last.open();
  const st = goldenState();
  st.sessions = st.sessions.map((x) => (x.ID === "s2" ? { ...x, Mate: { Name: "webby", Local: true } } : x));
  sockets.last.push({ state: { ...st, mates } });
  return { server, sockets };
}

const calls = (server: FakeServer) => server.calls.map((c) => c.method + " " + c.path);

describe("Mate page", () => {
  it("shows the stopped banner over the session list", async () => {
    setup("#/sessions", { ...board, stopped: true });
    expect(await screen.findByRole("status")).toHaveTextContent("All mates are stopped");
  });

  it("has three columns on the desktop: threads, the conversation and the settings rail", async () => {
    setup("#/mates/helper", board, [], undefined, true);
    expect(await screen.findByRole("heading", { name: "helper" })).toBeInTheDocument();
    const threads = screen.getByRole("navigation", { name: "Threads of helper" });
    const row = within(threads).getByRole("link", { name: /add login/ });
    expect(row).toHaveAttribute("href", "#/mates/helper/s1");
    expect(row).toHaveAttribute("aria-current", "page");
    expect(row).toHaveTextContent("Slack channel");
    expect(screen.getByRole("region", { name: "Conversation" })).toBeInTheDocument();
    expect(await screen.findByText("I fixed the docs.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in Slack" })).toHaveAttribute("href", "https://app.slack.com/client/T1/C1/thread/C1-1700.0001");
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveAttribute("placeholder", "Reply in this thread. It also posts to Slack.");
    const rail = screen.getByRole("complementary", { name: "Settings of helper" });
    expect(within(rail).getByText("Changes apply when the next conversation starts.")).toBeInTheDocument();
    expect(within(rail).getByRole("radio", { name: "Claude" })).toHaveAttribute("aria-checked", "true");
    expect(await within(rail).findByText(/Help\.\s+With care\./)).toBeInTheDocument();
    expect(within(rail).getByText(/Connected as @helper/)).toBeInTheDocument();
    expect(within(rail).getByRole("link", { name: "+ Add automation" })).toHaveAttribute("href", "#/automations/new?mate=helper");
  });

  it("gives a mate without Slack its app threads, with the normal composer", async () => {
    setup("#/mates/webby", board, [], undefined, true);
    const threads = await screen.findByRole("navigation", { name: "Threads of webby" });
    expect(within(threads).getByRole("link", { name: /fix the docs/ })).toHaveTextContent("App");
    expect(await screen.findByRole("textbox", { name: "Message" })).toHaveAttribute("placeholder", "Message Webby…");
    expect(screen.queryByRole("link", { name: "Open in Slack" })).toBeNull();
  });

  it("opens a mate with no threads straight into a chat, and the first message starts an app thread", async () => {
    const { server } = setup("#/mates/fresh", board, [], undefined, true);
    server.on("POST", "/api/v1/mates/fresh/new", { status: 200, body: { ID: "s10" } }).on("POST", "/api/v1/sessions/s10/messages", { status: 200, body: { id: "m1" } });
    const box = await screen.findByRole("textbox", { name: "Message" });
    expect(box).toHaveAttribute("placeholder", "Message Fresh…");
    expect(box).toHaveFocus();
    expect(screen.queryByText(/No threads yet/)).toBeNull();
    await userEvent.setup().type(box, "hello{Enter}");
    await waitFor(() => expect(window.location.hash).toBe("#/mates/fresh/s10"));
    expect(calls(server)).toEqual(expect.arrayContaining(["POST /api/v1/mates/fresh/new", "POST /api/v1/sessions/s10/messages"]));
  });

  it("has a New thread icon button with a tooltip next to the search", async () => {
    setup("#/mates/helper", board, [], undefined, true);
    const add = await screen.findByRole("button", { name: "New thread" });
    expect(add).toHaveAttribute("title", "New thread");
    expect(add.querySelector("svg")).not.toBeNull();
    expect(add).toHaveTextContent("");
  });

  it("shows the faces of the look at their real size", async () => {
    setup("#/mates/helper", board, [], undefined, true);
    const rail = await screen.findByRole("complementary", { name: "Settings of helper" });
    expect(within(rail).getByRole("button", { name: "Bolt" }).querySelector("svg")).toHaveAttribute("width", "28");
  });

  it("starts an app thread with New and opens it on the mate page", async () => {
    const { server } = setup("#/mates/helper", board, [], undefined, true);
    await userEvent.setup().click(await screen.findByRole("button", { name: "New thread" }));
    await waitFor(() => expect(window.location.hash).toBe("#/mates/helper/s9"));
    expect(calls(server)).toContain("POST /api/v1/mates/helper/new");
  });

  it("shows a failed New next to the threads", async () => {
    const { server } = setup("#/mates/helper", board, [], undefined, true);
    server.on("POST", "/api/v1/mates/helper/new", { status: 400, body: { error: { code: "bad_request", message: "no workspace to start in" } } });
    await userEvent.setup().click(await screen.findByRole("button", { name: "New thread" }));
    expect(await within(screen.getByRole("navigation", { name: "Threads of helper" })).findByRole("alert")).toHaveTextContent("no workspace to start in");
  });

  it("searches the threads", async () => {
    setup("#/mates/helper", { ...board, mates: [{ ...board.mates[0], conversations: board.mates[1].conversations }] }, [], undefined, true);
    const threads = await screen.findByRole("navigation", { name: "Threads of helper" });
    await userEvent.setup().type(within(threads).getByRole("searchbox", { name: "Search threads" }), "docs");
    expect(within(threads).getByRole("link", { name: /fix the docs/ })).toBeInTheDocument();
    expect(within(threads).queryByRole("link", { name: /add login/ })).toBeNull();
  });

  it("pauses a mate", async () => {
    const { server } = setup("#/mates/helper", board, [], undefined, true);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Pause" }));
    await waitFor(() => expect(calls(server)).toContain("POST /api/v1/mates/helper/pause"));
  });

  it("says there is no such mate", async () => {
    setup("#/mates/ghost", board, [], undefined, true);
    expect(await screen.findByText("There is no mate ghost.")).toBeInTheDocument();
  });

  it("saves the environment and the harness from the rail at once", async () => {
    const { server } = setup("#/mates/helper", board, [], undefined, true);
    const user = userEvent.setup();
    const rail = await screen.findByRole("complementary", { name: "Settings of helper" });
    const picker = await within(rail).findByRole("combobox", { name: "Environment" });
    await waitFor(() => expect(picker).toHaveTextContent("Local (crew)"));
    expect(within(rail).getByRole("link", { name: "Edit environment" })).toHaveAttribute("href", "#/envs/local");
    await user.click(picker);
    await user.click(await screen.findByRole("option", { name: "test-work" }));
    const saved = () => server.calls.filter((c) => c.method === "POST" && c.path === "/api/v1/mates").map((c) => c.body);
    await waitFor(() => expect(saved().at(-1)).toMatchObject({ mate: { name: "helper", env: "test-work", agent: "claude", model: "opus" } }));
    await user.click(within(rail).getByRole("radio", { name: "Pi" }));
    await waitFor(() => expect(saved().at(-1)).toMatchObject({ mate: { name: "helper", agent: "omp" } }));
  });

  it("edits the role in the rail", async () => {
    const { server } = setup("#/mates/helper", board, [], undefined, true);
    const user = userEvent.setup();
    const rail = await screen.findByRole("complementary", { name: "Settings of helper" });
    await user.click(await within(rail).findByRole("button", { name: "Edit role" }));
    const box = within(rail).getByRole("textbox", { name: "Role" });
    await user.clear(box);
    await user.type(box, "Review only.");
    await user.click(within(rail).getByRole("button", { name: "Save role" }));
    await waitFor(() => expect(server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/mates")?.body).toMatchObject({ mate: { name: "helper", prompt: "Review only." } }));
  });

  it("shows the memory size and edits the memory", async () => {
    const { server } = setup("#/mates/helper", board, [], undefined, true);
    const user = userEvent.setup();
    const rail = await screen.findByRole("complementary", { name: "Settings of helper" });
    expect(await within(rail).findByText("19 bytes")).toBeInTheDocument();
    await user.click(within(rail).getByRole("button", { name: "View and edit memory" }));
    expect(await screen.findByText("- Tests come first.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const box = screen.getByRole("textbox", { name: "Memory of helper" });
    await user.clear(box);
    await user.type(box, "- Small PRs.");
    await user.click(screen.getByRole("button", { name: "Save memory" }));
    await waitFor(() => expect(server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/mates/helper/memory")?.body).toEqual({ text: "- Small PRs." }));
  });

  it("lists the automations of the mate and adds one for this mate", async () => {
    setup("#/mates/helper", board, [], undefined, true);
    const rail = await screen.findByRole("complementary", { name: "Settings of helper" });
    expect(await within(rail).findByText("test-weekly")).toBeInTheDocument();
    expect(within(rail).getByText("weekly mon 09:00")).toBeInTheDocument();
    expect(within(rail).queryByText("test-solo")).not.toBeInTheDocument();
    expect(within(rail).getByRole("link", { name: "+ Add automation" })).toHaveAttribute("href", "#/automations/new?mate=helper");
  });

  it("tags a thread that an automation started as Automation", async () => {
    setup("#/mates/webby", board, [], undefined, true);
    const list = await screen.findByRole("navigation", { name: "Threads of webby" });
    expect(await within(list).findByText("Automation · idle")).toBeInTheDocument();
  });

  it("says where the mate answers in Slack", async () => {
    setup("#/mates/helper", board, [], undefined, true);
    const rail = await screen.findByRole("complementary", { name: "Settings of helper" });
    expect(within(rail).getByText("Answers in")).toBeInTheDocument();
    expect(within(rail).getByText("#api, #web, DMs")).toBeInTheDocument();
  });

  it("saves the tone, the face and the colour from the rail", async () => {
    const { server } = setup("#/mates/helper", board, [], undefined, true);
    const user = userEvent.setup();
    const rail = await screen.findByRole("complementary", { name: "Settings of helper" });
    const saved = () => server.calls.filter((c) => c.method === "POST" && c.path === "/api/v1/mates").map((c) => c.body);
    const slider = within(rail).getByRole("slider", { name: "Brief to Wordy" });
    slider.focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(saved().at(-1)).toMatchObject({ mate: { name: "helper", tone: { terse: 4, cautious: 3, formal: 3 } } }));
    await user.click(within(rail).getByRole("button", { name: "Bolt" }));
    await waitFor(() => expect(saved().at(-1)).toMatchObject({ mate: { name: "helper", avatar: "bolt" } }));
    const swatches = within(rail).getAllByRole("button", { name: /^Color / });
    await user.click(swatches[1]);
    await waitFor(() => expect((saved().at(-1) as { mate: { color?: string } }).mate.color).toMatch(/^#[0-9a-f]{6}$/i));
  });

  it("offers Connect… for a mate without Slack", async () => {
    setup("#/mates/fresh", board, [], undefined, true);
    const rail = await screen.findByRole("complementary", { name: "Settings of fresh" });
    expect(within(rail).getByText("Not connected")).toBeInTheDocument();
    await userEvent.setup().click(within(rail).getByRole("button", { name: "Connect…" }));
    expect(await screen.findByRole("link", { name: "Make the Slack app from the manifest" })).toHaveAttribute("href", "https://api.slack.com/apps?new_app=1");
  });

  it("stops all mates from the ⋯ menu only after a confirm", async () => {
    const { server } = setup("#/mates/helper", board, [], undefined, true);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "More for helper" }));
    await user.click(screen.getByRole("menuitem", { name: "Stop all mates…" }));
    const ask = screen.getByRole("dialog", { name: "Stop all mates?" });
    expect(calls(server)).not.toContain("POST /api/v1/mates/stop");
    await user.click(within(ask).getByRole("button", { name: "Stop all" }));
    await waitFor(() => expect(server.calls.find((c) => c.path === "/api/v1/mates/stop")?.body).toEqual({ stop: true }));
  });
});

describe("Mate page on the phone", () => {
  it("shows the header line, the thread chips and the chat", async () => {
    setup("#/mates/helper");
    expect(await screen.findByRole("heading", { name: "helper" })).toBeInTheDocument();
    expect(screen.getByText("Local · Claude · working")).toBeInTheDocument();
    const chips = screen.getByRole("navigation", { name: "Threads of helper" });
    expect(within(chips).getByRole("link", { name: /add login/ })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByText("I fixed the docs.")).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Settings of helper" })).toBeNull();
  });

  it("opens the settings as a sheet with ⓘ and closes it with Done", async () => {
    setup("#/mates/helper");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Settings of helper" }));
    const sheet = screen.getByRole("dialog", { name: "Settings of helper" });
    expect(within(sheet).getByRole("combobox", { name: "Environment" })).toBeInTheDocument();
    expect(within(sheet).getByText("Changes apply when the next conversation starts.")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("New mate", () => {
  it("is one composer: name on top, role text, chips and Create mate", async () => {
    const { server } = setup("#/mates/new");
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "New mate" })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
    const create = screen.getByRole("button", { name: "Create mate" });
    expect(create).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Name" }), "scout");
    expect(screen.getByText("name is free")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Role" }), "Scout the repo.");
    await user.click(screen.getByRole("button", { name: /^Harness/ }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Codex" }));
    expect(screen.getByRole("button", { name: /^Harness/ })).toHaveTextContent("Codex");
    await user.click(create);
    await waitFor(() => expect(window.location.hash).toBe("#/mates/scout"));
    expect(server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/mates")?.body).toEqual({
      mate: { name: "scout", prompt: "Scout the repo.", agent: "codex", avatar: expect.any(String), enabled: true },
    });
  });

  it("refuses a taken name and a name that is not a handle", async () => {
    setup("#/mates/new");
    const user = userEvent.setup();
    const name = await screen.findByRole("textbox", { name: "Name" });
    await user.type(screen.getByRole("textbox", { name: "Role" }), "Help.");
    await user.type(name, "helper");
    expect(await screen.findByText("A mate named helper exists.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create mate" })).toBeDisabled();
    await user.clear(name);
    await user.type(name, "!!!");
    expect(screen.getByText("Use up to 32 letters, digits, - and _.")).toBeInTheDocument();
  });

  it("saves a name with spaces and capitals as its slug and shows the slug", async () => {
    const { server } = setup("#/mates/new");
    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: "Name" }), "UX Patrol");
    expect(screen.getByText("Saved as ux-patrol")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Role" }), "Patrol the UX.");
    await user.click(screen.getByRole("button", { name: "Create mate" }));
    await waitFor(() => expect(server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/mates")?.body).toMatchObject({ mate: { name: "ux-patrol" } }));
  });

  it("picks the face and the color from a click on the face", async () => {
    const { server } = setup("#/mates/new");
    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: "Name" }), "scout");
    await user.type(screen.getByRole("textbox", { name: "Role" }), "Scout.");
    await user.click(screen.getByRole("button", { name: "Change face" }));
    const picker = await screen.findByRole("dialog", { name: "Face and color" });
    await user.click(within(picker).getByRole("button", { name: "Owl" }));
    await user.click(within(picker).getByRole("button", { name: "Color #40a02b" }));
    await user.click(within(picker).getByRole("button", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "Create mate" }));
    await waitFor(() => expect(server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/mates")?.body).toMatchObject({ mate: { name: "scout", avatar: "owl", color: "#40a02b" } }));
  });

  it("fills the role from a suggestion chip", async () => {
    setup("#/mates/new");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "On-call triage" }));
    expect((screen.getByRole("textbox", { name: "Role" }) as HTMLTextAreaElement).value).toMatch(/triage/i);
  });

  it("picks the environment from a chip with search and New environment", async () => {
    const { server } = setup("#/mates/new");
    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: "Name" }), "scout");
    await user.type(screen.getByRole("textbox", { name: "Role" }), "Scout.");
    const chip = screen.getByRole("button", { name: /Environment/ });
    expect(chip).toHaveTextContent("Local (crew)");
    await user.click(chip);
    const menu = await screen.findByRole("menu", { name: "Environment" });
    expect(within(menu).getByLabelText("Search environments")).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "+ New environment…" })).toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitemcheckbox", { name: "test-work" }));
    await user.click(screen.getByRole("button", { name: "Create mate" }));
    await waitFor(() => expect(server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/mates")?.body).toMatchObject({ mate: { name: "scout", env: "test-work" } }));
  });

  it("offers Pi with the agent omp", async () => {
    const { server } = setup("#/mates/new");
    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: "Name" }), "scout");
    await user.type(screen.getByRole("textbox", { name: "Role" }), "Scout.");
    await user.click(screen.getByRole("button", { name: /^Harness/ }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Pi" }));
    await user.click(screen.getByRole("button", { name: "Create mate" }));
    await waitFor(() => expect(server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/mates")?.body).toMatchObject({ mate: { agent: "omp" } }));
  });

  it("opens Slack Connect on the mate page when Slack is set to connect now", async () => {
    setup("#/mates/new");
    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: "Name" }), "scout");
    await user.type(screen.getByRole("textbox", { name: "Role" }), "Scout.");
    const slack = screen.getByRole("button", { name: /^Slack/ });
    expect(slack).toHaveTextContent("Slack: later");
    await user.click(slack);
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Connect now" }));
    await user.click(screen.getByRole("button", { name: "Create mate" }));
    await waitFor(() => expect(window.location.hash).toBe("#/mates/scout/~slack"));
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
