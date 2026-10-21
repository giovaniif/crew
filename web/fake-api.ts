import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { Plugin } from "vite";

export const fakePairCode = "ABCD2345";
export const fakeRateLimitedCode = "ZZZZZZZZ";

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function readJSON(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

const minute = 60000;

function fakeSession(id: string, over: Record<string, unknown>) {
  return {
    ID: id,
    TaskID: "t-" + id,
    Harness: "claude",
    Pane: "%" + id,
    Model: "",
    Effort: "",
    State: "idle",
    Ended: false,
    Unread: false,
    Focused: false,
    Muted: false,
    WorktreeIDs: null,
    ResumeID: "",
    Transcript: "",
    Dir: "",
    Usage: { ContextLeftPercent: 0, HasContext: false, LimitUsedPercent: 0 },
    Limits: null,
    LimitsAt: "0001-01-01T00:00:00Z",
    Switches: null,
    SwitchWarning: false,
    name: "",
    where: "",
    banner: "",
    since: null,
    ...over,
  };
}

export function fakeStreamState(now = Date.now()) {
  const ago = (minutes: number) => new Date(now - minutes * minute).toISOString();
  const quota = (harness: string, window: string, label: string, left: number, resetsIn: number) => ({
    Harness: harness,
    Window: window,
    LeftPercent: left,
    ResetsAt: resetsIn ? Math.floor((now + resetsIn * minute) / 1000) : 0,
    ReportedAt: ago(1),
    label,
    low: left < 20,
    stale_at: new Date(now + 14 * minute).toISOString(),
  });
  return {
    seq: 1,
    workspaces: [],
    tasks: [],
    worktrees: [
      { ID: "w1", Repo: "api", Path: "/home/me/.crew/worktrees/api/login", Branch: "login", PR: { Number: 41, Title: "Fix the login redirect", URL: "", Head: "login", State: "OPEN", Checks: "pending" }, SubtaskSlug: "", SessionID: "s1", Ports: null },
      { ID: "w2", Repo: "web", Path: "/home/me/.crew/worktrees/web/cache", Branch: "cache", PR: null, SubtaskSlug: "", SessionID: "s2", Ports: null },
      { ID: "w3", Repo: "api", Path: "/home/me/.crew/worktrees/api/old-auth", Branch: "old-auth", PR: { Number: 77, Title: "Drop the old auth", URL: "", Head: "old-auth", State: "MERGED", Checks: "pass" }, SubtaskSlug: "", SessionID: "", Ports: null },
      { ID: "w4", Repo: "web", Path: "/home/me/.crew/worktrees/web/tweak", Branch: "tweak", PR: { Number: 80, Title: "Tweak the header", URL: "", Head: "tweak", State: "MERGED", Checks: "pass" }, SubtaskSlug: "", SessionID: "", Ports: null },
      { ID: "w5", Repo: "api", Path: "/home/me/.crew/worktrees/api/spike", Branch: "", PR: null, SubtaskSlug: "", SessionID: "", Ports: null },
    ],
    sessions: [
      fakeSession("s1", { State: "permission", name: "fix the login redirect", where: "api@login", banner: "needs permission: Bash: make test", since: ago(3) }),
      fakeSession("s2", { Harness: "codex", State: "waiting", name: "pick a cache key", where: "web@cache", banner: "asks: Which TTL should the cache use?", since: ago(12) }),
      fakeSession("s3", { State: "running", name: "add retries", where: "api@retries", since: ago(8) }),
      fakeSession("s4", { State: "done", Unread: true, name: "update the docs", where: "docs@setup", banner: "Rewrote the setup section. (6m40s)", since: ago(20) }),
      fakeSession("s5", { Harness: "codex", State: "done", name: "bump deps", where: "web@deps", banner: "Bumped vite and vitest; the tests pass. (3m2s)", since: ago(125) }),
      fakeSession("s6", { State: "running", name: "explore the auth flow", where: "api@main", since: ago(4), Mate: { Name: "pip", Local: true, FreshFrom: "s5" } }),
    ],
    limits: [quota("claude", "five_hour", "5h", 38, 130), quota("claude", "seven_day", "7d", 19, 3 * 24 * 60), quota("codex", "five_hour", "5h", 77, 200)],
    sends: [
      { id: "m1", session: "s3", text: "then add a test for the backoff", queued_at: ago(2) },
      { id: "m2", session: "s3", text: "and update the README", queued_at: ago(1) },
    ],
    mates: fakeMates(process.env.CREW_FAKE_MATES === "stopped"),
  };
}

function fakeMates(stopped: boolean) {
  const held = stopped ? { guard: "stopped" } : {};
  return {
    stopped,
    mates: [
      {
        name: "helper",
        state: "connected",
        ...held,
        work: ["s3"],
        threads: [
          { mate: "helper", team: "T1", channel: "C1", thread_ts: "1700.0002", session_id: "s3", url: "https://app.slack.com/client/T1/C1/thread/C1-1700.0002", session: "add retries", state: "running", ended: false },
          { mate: "helper", team: "T1", channel: "C1", thread_ts: "1700.0001", session_id: "s5", url: "https://app.slack.com/client/T1/C1/thread/C1-1700.0001", session: "bump deps", state: "done", ended: false },
        ],
        conversations: [],
      },
      { name: "pip", state: "ready", ...held, work: ["s6"], threads: [], conversations: [{ session: "s6", name: "explore the auth flow", state: "running", ended: false, started_at: new Date(Date.now() - 4 * minute).toISOString() }] },
      { name: "reviewer", state: "connected", guard: stopped ? "stopped" : "rate_limit", work: [], threads: [], conversations: [] },
      { name: "webby", state: "paused", ...held, work: [], threads: [], conversations: [] },
    ],
  };
}

function fakeMessage(id: string, cursor: number, role: string, text: string, at: string, tool?: { name: string; summary: string; status: string }) {
  return { id, cursor, turn: "p1", role, text, ...(tool ? { tool } : {}), at };
}

export function fakeMessages(older: boolean, now = Date.now(), session = "") {
  const at = new Date(now - 5 * minute).toISOString();
  if (session === "s6" && !older) {
    return {
      messages: [
        fakeMessage("f1", 100, "user", "look at the auth flow and list the weak spots", at),
        fakeMessage("f2", 200, "assistant", "I read the handoff. I'll start with the token refresh path.", at),
        fakeMessage("f3", 300, "tool", "", at, { name: "Read", summary: "Read internal/auth/refresh.go", status: "running" }),
      ],
      before: 0,
    };
  }
  if (older) {
    return {
      messages: [
        fakeMessage("o1", 400, "user", "the client gives up on the first 503; add retries", at),
        fakeMessage("o2", 900, "assistant", "I'll start by finding where the client sends requests.", at),
        fakeMessage("o3", 1400, "tool", "", at, { name: "Grep", summary: "Grep http.NewRequest", status: "done" }),
        fakeMessage("o4", 2200, "tool", "", at, { name: "Read", summary: "Read internal/client/client.go", status: "done" }),
        fakeMessage("o5", 3000, "assistant", "`Do` sends once and returns the first error. I'll wrap it in a retry loop.", at),
      ],
      before: 0,
    };
  }
  return {
    messages: [
      fakeMessage("n1", 4300, "tool", "", at, { name: "Edit", summary: "Edit internal/client/client.go", status: "done" }),
      fakeMessage("n2", 5100, "tool", "ok  \tgithub.com/acme/api/internal/client\t0.41s\nok  \tgithub.com/acme/api/internal/server\t0.22s", at, { name: "Bash", summary: "Bash go test ./...", status: "done" }),
      fakeMessage("n3", 5600, "tool", "golangci-lint: errcheck: Error return value of `resp.Body.Close` is not checked", at, { name: "Bash", summary: "Bash make lint", status: "failed" }),
      fakeMessage("n4", 6400, "assistant", "The tests pass. Lint flagged one unchecked `Close`; fixing it now.\n\n- retries **3 times** on 502, 503 and 504\n- backs off 200 ms, doubling\n- honours `Retry-After`", at),
      fakeMessage("n5", 7000, "tool", "", at, { name: "Edit", summary: "Edit internal/client/client.go", status: "done" }),
      fakeMessage("n6", 7600, "tool", "", at, { name: "Bash", summary: "Bash make lint && go test ./...", status: "running" }),
      ...(session === "s4" ? [fakeMessage("n7", 8200, "tool", "", at, { name: "Bash", summary: "Bash crew browser screenshot", status: "done" })] : []),
    ],
    before: 4000,
  };
}

function wsFrame(text: string): Buffer {
  const payload = Buffer.from(text);
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x81, len]) : Buffer.from([0x81, 126, len >> 8, len & 255]);
  return Buffer.concat([head, payload]);
}

function wsClose(code: number): Buffer {
  return Buffer.from([0x88, 2, code >> 8, code & 255]);
}

let offlineServed = false;
let refusedServed = false;

function refusing(): boolean {
  const mode = process.env.CREW_FAKE_STREAM;
  return mode === "revoked" || mode === "late";
}

type FakeSend = { id: string; session: string; text: string; queued_at: string };

let fakeSends: FakeSend[] | null = null;
let fakeSeq = 1;
const liveSockets = new Set<Duplex>();

function publishSends() {
  fakeSeq++;
  const frame = wsFrame(JSON.stringify({ diff: { seq: fakeSeq, sends: fakeSends ?? [] } }));
  for (const socket of liveSockets) {
    socket.write(frame);
  }
}

function fakeStream(req: IncomingMessage, socket: Duplex) {
  const offline = process.env.CREW_FAKE_STREAM === "offline";
  if (offline && offlineServed) {
    socket.destroy();
    return;
  }
  const key = String(req.headers["sec-websocket-key"] ?? "");
  const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", "Sec-WebSocket-Accept: " + accept, "", ""].join("\r\n"));
  let authed = false;
  socket.on("data", (chunk: Buffer) => {
    if (authed || (chunk[0] & 0x0f) !== 1) {
      return;
    }
    authed = true;
    const state = fakeStreamState();
    fakeSends ??= state.sends;
    socket.write(wsFrame(JSON.stringify({ state: { ...state, seq: fakeSeq, sends: fakeSends } })));
    liveSockets.add(socket);
    if (offline) {
      offlineServed = true;
      setTimeout(() => socket.end(wsClose(1013)), 300);
    }
    if (refusing() && !refusedServed) {
      refusedServed = true;
      setTimeout(() => socket.end(wsClose(4401)), 300);
    }
  });
  socket.on("close", () => liveSockets.delete(socket));
  socket.on("error", () => undefined);
}

function wsBinary(payload: Buffer): Buffer {
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x82, len]) : Buffer.from([0x82, 126, len >> 8, len & 255]);
  return Buffer.concat([head, payload]);
}

function clientPayload(chunk: Buffer): { op: number; data: Buffer } | null {
  const len = chunk[1] & 0x7f;
  if (len >= 126 || chunk.length < 6 + len) {
    return null;
  }
  const mask = chunk.subarray(2, 6);
  const data = Buffer.alloc(len);
  for (let i = 0; i < len; i++) {
    data[i] = chunk[6 + i] ^ mask[i % 4];
  }
  return { op: chunk[0] & 0x0f, data };
}

function fakeScreen(pane: string): string {
  const rows = pane.endsWith("-nvim")
    ? ["\x1b[34m  1 \x1b[0mpackage auth", "\x1b[34m  2 \x1b[0m", "\x1b[34m  3 \x1b[0mfunc Redirect(next string) string {", "\x1b[34m  4 \x1b[0m\treturn sanitize(next)", "\x1b[34m  5 \x1b[0m}"]
    : pane.endsWith("-shell")
      ? ["\x1b[32m~/w/api\x1b[0m $ git status --short", " M auth/redirect.go", "?? auth/redirect_test.go", "\x1b[32m~/w/api\x1b[0m $ "]
      : ["\x1b[1m> fix the login redirect\x1b[0m", "", "\x1b[35m●\x1b[0m Read auth/redirect.go", "\x1b[35m●\x1b[0m Bash go test ./auth/...", "  \x1b[32mok\x1b[0m  example.com/api/auth  0.412s", "", "The redirect now keeps only same-origin paths."];
  return "\x1b[2J\x1b[H" + rows.join("\r\n");
}

function fakeTerminal(req: IncomingMessage, socket: Duplex, pane: string) {
  const key = String(req.headers["sec-websocket-key"] ?? "");
  const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", "Sec-WebSocket-Accept: " + accept, "", ""].join("\r\n"));
  let authed = false;
  socket.on("data", (chunk: Buffer) => {
    const frame = clientPayload(chunk);
    if (!frame) {
      return;
    }
    if (!authed && frame.op === 1) {
      authed = true;
      const first = JSON.parse(frame.data.toString() || "{}");
      const screen = { pane, window: "@1", cols: first.cols ?? 80, rows: first.rows ?? 24, cursor: { x: 0, y: 0, visible: true }, data: fakeScreen(pane) };
      socket.write(wsFrame(JSON.stringify({ screen })));
      return;
    }
    if (authed && frame.op === 2) {
      socket.write(wsBinary(frame.data));
    }
  });
  socket.on("error", () => undefined);
}
const goLine = (Kind: number, Old: number, New: number, Text: string) => {
  const spans: [number, number, string][] = [];
  for (const m of Text.matchAll(/\b(func|return|if|for|package|import|err|nil)\b|"[^"]*"|\/\/.*$|\b\d+\b/g)) {
    const at = new TextEncoder().encode(Text.slice(0, m.index)).length;
    const end = at + new TextEncoder().encode(m[0]).length;
    spans.push([at, end, m[0].startsWith('"') ? "string" : m[0].startsWith("//") ? "comment" : /^\d/.test(m[0]) ? "number" : "keyword"]);
  }
  return { Kind, Old, New, Text, Spans: spans };
};

const fakeReview = {
  scope: "branch",
  viewed: [{ Worktree: "w1", Path: "src/client.go", Blob: "b1" }],
  draft: {
    id: "d1",
    session: "s3",
    status: "open",
    turns: null,
    comments: [{ id: "c1", worktree: "/home/me/api-retries", path: "src/retry.go", start: 14, end: 15, code: [], body: "Cap the backoff at 30 s." }],
  },
  worktrees: [
    {
      Worktree: { ID: "w1", Repo: "/home/me/api", Path: "/home/me/api-retries", Branch: "42-add-retries", PR: { Number: 42 } },
      From: "abc123",
      Err: "",
      Files: [
        {
          Path: "src/retry.go",
          OldPath: "",
          Status: "M",
          Added: 5,
          Deleted: 1,
          Binary: false,
          Blob: "b2",
          Hunks: [
            {
              Header: "@@ -10,6 +10,10 @@ func Do(ctx context.Context, fn func() error) error {",
              Lines: [
                goLine(32, 10, 10, "\tvar err error"),
                goLine(32, 11, 11, "\tfor attempt := 0; attempt < 5; attempt++ {"),
                goLine(45, 12, 0, "\t\ttime.Sleep(time.Second)"),
                goLine(43, 0, 12, "\t\tdelay := time.Duration(1<<attempt) * 100 * time.Millisecond"),
                goLine(43, 0, 13, "\t\t// wait before the next try"),
                goLine(43, 0, 14, "\t\ttime.Sleep(delay)"),
                goLine(43, 0, 15, "\t\tif err = fn(); err == nil {"),
                goLine(43, 0, 16, "\t\t\treturn nil"),
                goLine(32, 13, 17, "\t\t}"),
                goLine(32, 14, 18, "\t}"),
                goLine(32, 15, 19, "\treturn err"),
              ],
            },
          ],
        },
        { Path: "src/client.go", OldPath: "", Status: "M", Added: 2, Deleted: 2, Binary: false, Blob: "b1", Hunks: [] },
        { Path: "src/retry_test.go", OldPath: "", Status: "A", Added: 24, Deleted: 0, Binary: false, Blob: "b3", Hunks: [] },
      ],
    },
    {
      Worktree: { ID: "w2", Repo: "/home/me/web", Path: "/home/me/web-retries", Branch: "42-add-retries", PR: null },
      From: "def456",
      Err: "",
      Files: [{ Path: "src/api.ts", OldPath: "", Status: "M", Added: 3, Deleted: 1, Binary: false, Blob: "b4", Hunks: [] }],
    },
  ],
};

export function fakeApi(build = "v0.12.0+demo"): Plugin {
  return {
    name: "crew-fake-api",
    configureServer(server) {
      server.httpServer?.on("upgrade", (req: IncomingMessage, socket: Duplex) => {
        const path = (req.url ?? "").split("?")[0];
        if (path === "/api/v1/stream") {
          fakeStream(req, socket);
        }
        if (path.startsWith("/api/v1/terminal/")) {
          fakeTerminal(req, socket, decodeURIComponent(path.slice("/api/v1/terminal/".length)));
        }
      });
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? "").split("?")[0];
        if (req.method === "GET" && path === "/api/v1/hello") {
          send(res, 200, { api: "v1", build });
          return;
        }
        if (req.method === "POST" && path === "/api/v1/pair") {
          const body = await readJSON(req);
          const code = String(body.code ?? "");
          if (code === fakeRateLimitedCode) {
            send(res, 429, { error: { code: "rate_limited", message: "too many failed pairing tries; wait a minute" } });
            return;
          }
          if (code !== fakePairCode) {
            send(res, 401, { error: { code: "unauthorized", message: "the pairing code is wrong or has expired" } });
            return;
          }
          const now = new Date().toISOString();
          send(res, 200, {
            device: { id: "k3m9p2qx", name: String(body.name ?? "phone"), created_at: now, last_seen: now },
            token: "demo-token",
          });
          return;
        }
        const pane = path.match(/^\/api\/v1\/sessions\/([^/]+)\/(shell|nvim)$/);
        if (pane && req.method === "POST") {
          send(res, 200, { pane: "%" + decodeURIComponent(pane[1]) + "-" + pane[2], dir: "/w/api", shown: true });
          return;
        }
        const review = path.match(/^\/api\/v1\/sessions\/([^/]+)\/review(\/[a-z]+)?$/);
        if (review) {
          const sub = review[2] ?? "";
          if (req.method === "GET" && sub === "") {
            const scope = new URL(req.url ?? "", "http://fake").searchParams.get("scope") || "branch";
            send(res, 200, { ...fakeReview, scope });
            return;
          }
          if (req.method === "POST" && sub === "/hunk") {
            send(res, 500, { error: { code: "failed", message: "error: patch failed: src/retry.go:12\nerror: src/retry.go: patch does not apply" } });
            return;
          }
          if (req.method === "POST" && (sub === "/comments" || sub === "/send")) {
            send(res, 200, { ...fakeReview.draft, status: sub === "/send" ? "queued" : "open" });
            return;
          }
          send(res, 200, {});
          return;
        }
        const session = path.match(/^\/api\/v1\/sessions\/([^/]+)\/(messages|interrupt|prompt|answer|sends\/[^/]+)$/);
        if (session && req.method === "GET" && session[2] === "messages") {
          const older = new URL(req.url ?? "", "http://fake").searchParams.has("before");
          setTimeout(() => send(res, 200, fakeMessages(older, Date.now(), session[1])), older ? 5000 : 0);
          return;
        }
        if (session && req.method === "POST" && session[2] === "messages") {
          const body = await readJSON(req);
          const queued = { id: "m" + Date.now(), session: decodeURIComponent(session[1]), text: String(body.text ?? ""), queued_at: new Date().toISOString() };
          fakeSends = [...(fakeSends ?? []), queued];
          publishSends();
          send(res, 200, { id: queued.id, queued: true });
          return;
        }
        if (session && req.method === "DELETE" && session[2].startsWith("sends/")) {
          const id = decodeURIComponent(session[2].slice("sends/".length));
          const before = fakeSends ?? [];
          fakeSends = before.filter((q) => q.id !== id);
          if (fakeSends.length === before.length) {
            send(res, 404, { error: { code: "not_found", message: "no queued send " + id } });
            return;
          }
          publishSends();
          send(res, 200, {});
          return;
        }
        if (session && req.method === "GET" && session[2] === "prompt") {
          if (process.env.CREW_FAKE_PROMPT === "raw") {
            send(res, 200, { text: "", choices: [], raw: "Allow this unusual request?\n  [a] allow  [d] deny" });
            return;
          }
          send(res, 200, {
            text: "Bash command\n\nmake test\n\nDo you want to proceed?",
            choices: [
              { id: "1", label: "Yes" },
              { id: "2", label: "Yes, and don't ask again for make commands" },
              { id: "3", label: "No, and tell Claude what to do differently" },
            ],
          });
          return;
        }
        if (session && req.method === "POST" && session[2] === "answer") {
          const body = await readJSON(req);
          if (body.choice === "3") {
            send(res, 409, { error: { code: "stale", message: "session is no longer waiting for a permission" } });
            return;
          }
          send(res, 200, {});
          return;
        }
        if (session && req.method === "POST" && session[2] === "interrupt") {
          send(res, 200, {});
          return;
        }
        if (req.method === "GET" && path === "/api/v1/workspaces" && process.env.CREW_FAKE_STREAM === "revoked") {
          send(res, 401, { error: { code: "unauthorized", message: "unknown or revoked device token" } });
          return;
        }
        if (req.method === "GET" && /^\/api\/v1\/sessions\/[^/]+\/browser$/.test(path)) {
          const png = readFileSync(new URL("./scripts/demo-headless.png", import.meta.url)).toString("base64");
          send(res, 200, path === "/api/v1/sessions/s1/browser" ? { live: true, png, width: 960, height: 600 } : { live: false });
          return;
        }
        if (req.method === "POST" && path === "/api/v1/browser/cookies") {
          send(res, 200, { imported: 3, total: 3 });
          return;
        }
        if (req.method === "GET" && path === "/api/v1/disk") {
          const at = (minutes: number) => new Date(Date.now() - minutes * minute).toISOString();
          send(res, 200, {
            free: 61_400_000_000,
            total: 494_000_000_000,
            auto_clean_every: 600_000_000_000,
            next_cleanup: new Date(Date.now() + 7 * minute).toISOString(),
            deps_store: { path: "/home/me/.local/share/pnpm/store", size: 3_100_000_000 },
            rows: [
              { WorktreeID: "w1", Size: 412_000_000, Action: "keep", Reason: "its session is live" },
              { WorktreeID: "w2", Size: 1_240_000_000, Action: "keep", Reason: "its session is live" },
              { WorktreeID: "w3", Size: 214_000_000, Action: "remove", Reason: "PR #77 merged" },
              { WorktreeID: "w4", Size: 530_000_000, Action: "backup_then_ask", Reason: "3 uncommitted changes" },
              { WorktreeID: "w5", Size: 88_000_000, Action: "keep", Reason: "not merged" },
            ],
            recent: [
              { at: at(25), path: "/home/me/.crew/worktrees/api/rate-limit", branch: "rate-limit", action: "remove", outcome: "removed" },
              { at: at(150), path: "/home/me/.crew/worktrees/web/footer", branch: "footer", action: "backup_then_ask", outcome: "backed up, removed" },
            ],
            reclaimable: 744_000_000,
            reclaimable_pending: 0,
            worktrees_size: 2_484_000_000,
            worktrees_pending: 0,
            ports: [{ port: 5173, pgid: 4242, command: "node", worktree: "/home/me/.crew/worktrees/api/login", session: "s1" }],
          });
          return;
        }
        if (req.method === "GET" && path === "/api/v1/automations") {
          send(res, 200, {
            automations: [
              { name: "fix-ci", agent: "claude", prompt: "Fix the CI of {{work_item}}.", on: ["pr.ci_failed"], enabled: true, source: "/home/me/.crew/config.toml" },
              { name: "deps", agent: "codex", prompt: "Update the deps.", schedule: "weekly mon 09:00", enabled: false, source: "/home/me/.crew/config.toml" },
              { name: "audit", agent: "claude", prompt: "Audit the api.", enabled: true, source: "/home/me/api/.crew.toml" },
            ],
          });
          return;
        }
        if (req.method === "GET" && path === "/api/v1/mates") {
          send(res, 200, {
            mates: [
              { name: "helper", prompt: "Fast fixer. Short replies, small PRs.", agent: "codex", model: "gpt-5", effort: "medium", repos: ["api"], avatar: "bolt", enabled: true },
              { name: "pip", prompt: "Careful reviewer. Asks before it merges.", agent: "claude", model: "opus", effort: "high", repos: ["api", "web"], avatar: "pip", enabled: true },
              { name: "reviewer", prompt: "Docs and tests. Never skips a case.", agent: "claude", avatar: "iris", enabled: true },
              { name: "webby", prompt: "You help with the web.", agent: "codex", enabled: false },
            ],
            limits: { hop_limit: 5, turns_per_hour: 20, daily_turns: 100, daily_tokens: 0, stop: false },
            tones: [
              { key: "terse", low: "Terse", high: "Chatty", steps: ["Keep answers very short.", "Keep answers short. Use lists, not paragraphs.", "", "Explain your thinking in a few sentences.", "Explain your thinking in full."] },
              { key: "cautious", low: "Cautious", high: "Bold", steps: ["Ask before each change.", "Ask before you run a command that changes files or pushes.", "", "Make reasonable choices without asking.", "Act on your own judgment."] },
              { key: "formal", low: "Formal", high: "Playful", steps: ["Write in a formal, neutral tone.", "Write in a plain, professional tone.", "", "Use a light, friendly tone.", "Be playful."] },
            ],
          });
          return;
        }
        if (req.method === "GET" && /^\/api\/v1\/mates\/[^/]+\/memory$/.test(path)) {
          send(res, 200, { name: path.split("/")[4], path: "~/.crew/mates/" + path.split("/")[4] + "/memory.md", text: "- Owner wants small PRs, one per issue.\n- Tests come first in api/.\n- Never force-push main.", limit: 8192 });
          return;
        }
        if (req.method === "POST" && /^\/api\/v1\/mates\/[^/]+\/new$/.test(path)) {
          send(res, 200, { ID: "s6" });
          return;
        }
        if (req.method === "GET" && path === "/api/v1/approvals") {
          send(res, 200, [
            {
              ID: "approval-2",
              SessionID: "s3",
              Mate: "helper",
              Requester: "U0GUEST01",
              Action: { Kind: "create_pr", Tool: "Bash", Input: '{"command":"gh pr create --fill --base main"}' },
              At: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
              State: "pending",
            },
            {
              ID: "approval-1",
              SessionID: "s3",
              Mate: "helper",
              Requester: "U0GUEST01",
              Action: { Kind: "push", Tool: "Bash", Input: '{"command":"git push origin fix-login"}' },
              At: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
              State: "pending",
            },
          ]);
          return;
        }
        if (req.method === "POST" && /^\/api\/v1\/approvals\/[^/]+\/(approve|deny)$/.test(path)) {
          send(res, 200, { ID: path.split("/")[4], State: path.endsWith("approve") ? "granted" : "denied" });
          return;
        }
        if (req.method === "GET" && path === "/api/v1/automations/runs") {
          send(res, 200, {
            runs: [
              { id: "r3", automation: "fix-ci", trigger: "pr.ci_failed", outcome: "succeeded", session_id: "s3", start: "2026-10-03T11:40:00Z" },
              { id: "r2", automation: "audit", trigger: "manual", outcome: "failed", reason: "agent exited with status 1", start: "2026-10-03T09:10:00Z" },
              { id: "r1", automation: "fix-ci", trigger: "pr.ci_failed", outcome: "skipped", reason: "precheck failed", start: "2026-10-02T16:00:00Z" },
            ],
          });
          return;
        }
        if (req.method === "POST" && path === "/api/v1/workspaces") {
          const body = await readJSON(req);
          send(res, 200, { Root: String(body.path ?? ""), Kind: "single", Repos: [], LastUsed: "0001-01-01T00:00:00Z" });
          return;
        }
        if (req.method === "POST" && path === "/api/v1/workspaces/remove") {
          send(res, 200, {});
          return;
        }
        if (req.method === "POST" && path.startsWith("/api/v1/automations/")) {
          send(res, 200, { run: { id: "r9", automation: "fix-ci", outcome: "skipped", reason: "precheck failed" }, session: {} });
          return;
        }
        if (req.method === "GET" && path === "/api/v1/workspaces") {
          send(res, 200, {
            workspaces: [
              { Root: "/home/me/api", Kind: "single", Repos: [], LastUsed: "2026-10-03T12:00:00Z" },
              { Root: "/home/me/web", Kind: "single", Repos: [], LastUsed: "2026-10-01T12:00:00Z" },
            ],
            last_used: "/home/me/api",
          });
          return;
        }
        if (req.method === "GET" && path === "/api/v1/session-options") {
          send(res, 200, {
            harnesses: [
              { harness: "claude", models: ["opus", "sonnet", "haiku"], efforts: ["low", "medium", "high", "xhigh"], default_model: "opus", default_effort: "high" },
              { harness: "codex", models: ["gpt-6.1-sol", "gpt-6.1-mini"], efforts: ["low", "medium", "high"], default_model: "gpt-6.1-sol", default_effort: "medium" },
            ],
            home: "/home/me",
          });
          return;
        }
        if (req.method === "POST" && /^\/api\/v1\/sessions\/[^/]+\/kill-dev-servers$/.test(path)) {
          send(res, 200, { killed: [4211] });
          return;
        }
        if (req.method === "POST" && /^\/api\/v1\/sessions\/[^/]+\/(switch|rename|mute|end|resume)$/.test(path)) {
          send(res, 200, {});
          return;
        }
        if (req.method === "GET" && path === "/api/v1/work-items/resolve") {
          const query = new URL(req.url ?? "", "http://fake").searchParams;
          const item = query.get("item") ?? "";
          const workspace = query.get("workspace") ?? "";
          const pr = item.match(/^https:\/\/github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/);
          if (pr) {
            send(res, 200, { source: "pr", ref: pr[1] + "#" + pr[2], title: "Fix the login redirect", worktree: pr[1] + "-" + pr[2], workspace });
            return;
          }
          if (item.startsWith("http")) {
            send(res, 400, { error: { code: "bad_request", message: "unsupported link: use a GitHub pull request URL" } });
            return;
          }
          send(res, 200, { source: "text", title: item, worktree: item.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), workspace });
          return;
        }
        if (req.method === "POST" && path === "/api/v1/sessions") {
          const body = await readJSON(req);
          if (String(body.work_item ?? "").includes("broken")) {
            send(res, 500, {
              error: { code: "failed", message: "setup /home/me/.crew/worktrees/api/broken: npm ci: exit status 1\nnpm ERR! code EUSAGE\nnpm ERR! missing lockfile" },
            });
            return;
          }
          send(res, 200, fakeSession("s9", { name: String(body.work_item ?? ""), State: "running" }));
          return;
        }
        if (path.startsWith("/api/")) {
          send(res, 404, { error: { code: "not_found", message: "not in the fake API" } });
          return;
        }
        next();
      });
    },
  };
}
