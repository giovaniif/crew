import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { App, type AppEnv } from "../App";
import type { Frame, Session, StreamState } from "../stream";
import { FakeServer, MemoryStorage } from "./fake-server";
import { FakeSockets } from "./fake-socket";
import { FakeTerminals } from "./fake-terminal";
import { FakeWidth } from "./fake-width";

const golden = (name: string) => JSON.parse(readFileSync(new URL("../../../internal/serve/testdata/" + name, import.meta.url), "utf8"));
export const goldenState = (): StreamState => (golden("stream-state.json") as Frame).state as StreamState;
const device = { id: "k3m9p2qx", name: "Laptop", created_at: "2026-10-03T10:00:00Z", last_seen: "2026-10-03T10:00:00Z" };
export const halfPastNoon = new Date("2026-10-03T12:30:00Z").getTime();

export function session(id: string, name: string, extra: Partial<Session> = {}): Session {
  return { ...goldenState().sessions[0], ID: id, name, WorktreeIDs: null, order: undefined, ...extra };
}

export function desktop(hash = "", wide = true, userAgent = "Mozilla/5.0 (X11; Linux x86_64)", extra: Partial<AppEnv> = {}) {
  window.location.hash = hash;
  const sockets = new FakeSockets();
  const storage = new MemoryStorage();
  storage.setItem("crew.auth", JSON.stringify({ token: "t0k", device }));
  const server = new FakeServer()
    .on("GET", "/api/v1/hello", { status: 200, body: { api: "v1", build: "v0.12.0+abc" } })
    .on("GET", "/api/v1/workspaces", { status: 200, body: { workspaces: [], last_used: "" } });
  const width = new FakeWidth(wide);
  const terminals = new FakeTerminals();
  const env: AppEnv = {
    fetch: server.fetch,
    storage,
    installed: true,
    hash,
    host: "crew.example.ts.net",
    userAgent,
    openStream: sockets.open,
    retryDelay: () => 5,
    now: () => halfPastNoon,
    onHashChange: (cb) => {
      const listener = () => cb(window.location.hash);
      window.addEventListener("hashchange", listener);
      return () => window.removeEventListener("hashchange", listener);
    },
    wide: width,
    terminal: terminals.env,
    ...extra,
  };
  render(<App env={env} />);
  const live = (state: StreamState = goldenState()) => {
    sockets.last.open();
    sockets.last.push({ state });
  };
  return { sockets, storage, server, width, live, terminals };
}
