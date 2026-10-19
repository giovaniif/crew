import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App, type AppEnv } from "../App";
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
    { name: "helper", prompt: "Help.\nMore help.", agent: "claude", model: "opus", effort: "high", repos: ["api"], avatar: "owl", enabled: true },
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

function setup(hash = "#/mates", mates: Mates = board, approvals: unknown[] = []) {
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

  it("shows a face card for each mate with its state, linked to the profile", async () => {
    setup();
    const helper = await screen.findByRole("link", { name: /^helper/ });
    expect(helper).toHaveAttribute("href", "#/mates/helper");
    expect(await within(helper).findByRole("img", { name: "Owl working" })).toBeInTheDocument();
    expect(helper).toHaveTextContent("Help.");
    expect(helper).not.toHaveTextContent("More help.");
    expect(helper).toHaveTextContent("working");
    expect(within(screen.getByRole("link", { name: /^webby/ })).getByText("paused")).toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: /^fresh/ })).getByText("idle")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New mate" })).toHaveAttribute("href", "#/mates/new");
    expect(await screen.findByText("No approvals wait for you.")).toBeInTheDocument();
  });

  it("shows needs you on the face of a mate with a pending approval", async () => {
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
    const helper = await screen.findByRole("link", { name: /^helper/ });
    expect(await within(helper).findByText("needs you")).toBeInTheDocument();
    expect(within(helper).getByRole("img", { name: "Owl needs" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "helper: merge" })).toBeInTheDocument();
  });

  it("stops all mates only after a confirm", async () => {
    const { server } = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Stop all mates" }));
    expect(server.calls.some((c) => c.path === "/api/v1/mates/stop")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Stop all" }));
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
  it("shows the face, the prompt, the brains, the threads and the memory", async () => {
    setup("#/mates/helper");
    expect(await screen.findByRole("heading", { name: "helper" })).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "Owl working" })).toBeInTheDocument();
    for (const chip of ["claude", "opus", "effort high", "api"]) {
      expect(screen.getByText(chip)).toBeInTheDocument();
    }
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

  it("edits the memory", async () => {
    const { server } = setup("#/mates/helper");
    const user = userEvent.setup();
    await screen.findByText("- Tests come first.");
    await user.click(screen.getByRole("button", { name: "Edit memory" }));
    const box = screen.getByLabelText("Memory of helper");
    await user.clear(box);
    await user.type(box, "- Small PRs.");
    await user.click(screen.getByRole("button", { name: "Save memory" }));
    expect(await screen.findByText("- Small PRs.")).toBeInTheDocument();
    expect(server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/mates/helper/memory")?.body).toEqual({ text: "- Small PRs." });
  });

  it("offers Connect to Slack with the Slack mark for a mate without Slack", async () => {
    setup("#/mates/fresh");
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: /Connect to Slack/ });
    expect(within(button).getByRole("img", { name: "Slack" })).toBeInTheDocument();
    await user.click(button);
    expect(await screen.findByRole("link", { name: "Make the Slack app from the manifest" })).toHaveAttribute(
      "href",
      "https://api.slack.com/apps?new_app=1",
    );
  });

  it("does not offer Slack to a connected mate", async () => {
    setup("#/mates/helper");
    await screen.findByRole("heading", { name: "helper" });
    expect(screen.queryByRole("button", { name: /Connect to Slack/ })).toBeNull();
  });
});

describe("New mate", () => {
  it("makes a mate in three steps: face, personality with tone, brains", async () => {
    const { server } = setup("#/mates/new");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Quill" }));
    expect(screen.getByRole("button", { name: "Quill" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Color #209fb5" }));
    await user.type(screen.getByLabelText("Name"), "scout");
    await user.click(screen.getByRole("button", { name: "Next: personality" }));
    await user.type(screen.getByLabelText("Prompt"), "Scout the repo.");
    expect(screen.getByRole("region", { name: "Added to the prompt" })).toHaveTextContent("Middle step. Adds no text.");
    fireEvent.change(screen.getByLabelText("Brief to Wordy"), { target: { value: "1" } });
    expect(screen.getAllByText("Brief 2/5").length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: "Added to the prompt" })).toHaveTextContent("Write one line per answer.");
    await user.click(screen.getByRole("button", { name: "Next: brains" }));
    await user.selectOptions(screen.getByLabelText("Agent"), "codex");
    await user.type(screen.getByLabelText("Model"), "gpt-5");
    await user.type(screen.getByLabelText("Effort"), "high");
    await user.type(screen.getByLabelText("Repos"), "api, web");
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

  it("goes back a step and keeps the choices", async () => {
    setup("#/mates/new");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "scout");
    await user.click(screen.getByRole("button", { name: "Next: personality" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Name")).toHaveValue("scout");
  });
});

describe("Mate conversation", () => {
  it("shows the face of the mate and starts fresh after it asks for a handoff", async () => {
    const { server } = setup("#/sessions/s2");
    const user = userEvent.setup();
    expect(await screen.findByRole("img", { name: /^Owl paused$|paused$/ })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Start fresh" }));
    await waitFor(() => expect(window.location.hash).toBe("#/sessions/s8"));
    expect(calls(server).filter((c) => c.startsWith("POST"))).toEqual(["POST /api/v1/sessions/s2/messages", "POST /api/v1/mates/webby/new"]);
    expect(server.calls.find((c) => c.path === "/api/v1/sessions/s2/messages")?.body).toEqual({
      text: "Before we stop: add a short handoff to your memory file. Note what you did, what is left and what you learned.",
    });
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
