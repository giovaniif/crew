import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { App, type AppEnv } from "../App";
import type { Frame, Mates, StreamState } from "../stream";
import { FakeDesktop } from "./fake-desktop";
import { FakeServer, MemoryStorage } from "./fake-server";
import { FakeSockets } from "./fake-socket";
import { FakeWidth } from "./fake-width";

const golden = (name: string) => JSON.parse(readFileSync(new URL("../../../internal/serve/testdata/" + name, import.meta.url), "utf8"));
const device = { id: "k3m9p2qx", name: "Laptop", created_at: "2026-10-03T10:00:00Z", last_seen: "2026-10-03T10:00:00Z" };

export type MateDef = { name: string; prompt: string; agent: string; env?: string; enabled: boolean; model?: string };

export type Identity = {
  name: string;
  kind: "local" | "custom";
  parts?: string[];
  secrets?: { name: string; set: boolean }[];
  codex_login?: boolean;
  pi_login?: boolean;
};

export type FakeMachine = {
  id: string;
  name: string;
  identities: Identity[];
  mates: MateDef[];
  found?: Record<string, unknown>;
  down?: boolean;
};

export function identity(name: string, extra: Partial<Identity> = {}): Identity {
  return name === "yours" ? { name, kind: "local", ...extra } : { name, kind: "custom", parts: ["git", "ssh"], ...extra };
}

export function machineServer(m: FakeMachine): FakeServer {
  const server = new FakeServer()
    .on("GET", "/api/v1/hello", { status: 200, body: { api: "v1", build: "v0.12.0+abc" } })
    .on("GET", "/api/v1/workspaces", { status: 200, body: { workspaces: [], last_used: "" } })
    .on("GET", "/api/v1/approvals", { status: 200, body: [] })
    .on("GET", "/api/v1/automations", { status: 200, body: { automations: [] } })
    .on("GET", "/api/v1/envs", { status: 200, body: { envs: m.identities.map((i) => ({ parts: [], secrets: [], used_by: [], ...i })) } })
    .on("GET", "/api/v1/mates", { status: 200, body: { mates: m.mates, limits: { hop_limit: 5, turns_per_hour: 20, daily_turns: 100, daily_tokens: 0, stop: false }, tones: [] } })
    .on("POST", "/api/v1/mates", (call) => ({ status: 200, body: (call.body as { mate: MateDef }).mate }));
  for (const mate of m.mates) {
    server.on("GET", "/api/v1/mates/" + mate.name + "/memory", { status: 200, body: { name: mate.name, path: "/m/memory.md", text: "", limit: 8192 } });
  }
  if (m.down) {
    server.on("GET", "/api/v1/environments", new Error("connection refused"));
  } else {
    server.on("GET", "/api/v1/environments", {
      status: 200,
      body: { machine: { id: m.id, name: m.name }, identities: m.identities.map((i) => ({ parts: [], secrets: [], used_by: [], ...i })), found: m.found },
    });
  }
  return server;
}

export function board(names: string[]): Mates {
  return { stopped: false, mates: names.map((name) => ({ name, state: "ready", work: [], threads: [], conversations: [] })) };
}

export type Setup = {
  hash: string;
  wide?: boolean;
  host?: string;
  machines: FakeMachine[];
  desktop?: boolean;
};

export function mount(s: Setup) {
  window.location.hash = s.hash;
  const sockets = new FakeSockets();
  const storage = new MemoryStorage();
  storage.setItem("crew.auth", JSON.stringify({ token: "t0k", device }));
  const servers = new Map(s.machines.map((m, i) => [i === 0 ? "local" : "ssh:" + m.name, machineServer(m)]));
  const first = servers.get("local")!;
  let desktop: FakeDesktop | undefined;
  if (s.desktop) {
    desktop = new FakeDesktop();
    desktop.servers = [
      { id: "local", name: "This computer", kind: "local", detail: "crew on this computer" },
      ...s.machines.slice(1).map((m) => ({ id: "ssh:" + m.name, name: m.name, kind: "ssh" as const, detail: "over SSH" })),
    ];
    desktop.handlers.crew_machine_request = async (args) => {
      const server = servers.get(String(args?.machineId));
      if (!server) {
        throw "machine not reachable";
      }
      const body = typeof args?.body === "string" ? args.body : undefined;
      try {
        const res = await server.fetch(String(args?.path), { method: String(args?.method ?? "GET"), body });
        return { status: res.status, body: await res.text() };
      } catch {
        throw "machine not reachable";
      }
    };
  }
  const env: AppEnv = {
    fetch: first.fetch,
    storage,
    installed: true,
    hash: s.hash,
    host: s.host ?? "localhost:7420",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    openStream: sockets.open,
    now: () => Date.parse("2026-10-03T12:00:00Z"),
    onHashChange: () => () => undefined,
    wide: new FakeWidth(s.wide ?? true),
    desktop,
  };
  render(<App env={env} />);
  sockets.last.open();
  const st = (golden("stream-state.json") as Frame).state as StreamState;
  sockets.last.push({ state: { ...st, mates: board(s.machines[0].mates.map((m) => m.name)) } });
  return { servers, desktop, sockets };
}

export function posts(server: FakeServer, path: string): unknown[] {
  return server.calls.filter((c) => c.method === "POST" && c.path === path).map((c) => c.body);
}
