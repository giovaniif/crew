import { describe, expect, it } from "vitest";
import { desktopMachines, loadHub, MachineStreams, pairedMachines, withSessions, type MachineLink } from "./machines";
import { FakeServer } from "./test/fake-server";
import { FakeDesktop } from "./test/fake-desktop";
import { FakeSockets } from "./test/fake-socket";

const server0 = new FakeServer();

function state(sessions: { ID: string; name: string }[]) {
  return { seq: 1, workspaces: [], tasks: [], worktrees: [], sessions, limits: [], sends: [] };
}

function live(sessions: { ID: string; name: string }[]) {
  return { status: "live" as const, state: state(sessions) as never, retryAt: null, reason: "", code: null };
}

function tick() {
  return new Promise((r) => setTimeout(r, 0));
}

describe("machine streams", () => {
  it("opens one desktop stream for each machine and passes its frames on", async () => {
    const desktop = new FakeDesktop();
    desktop.handlers.crew_machine_stream = () => 3;
    const [first] = await desktopMachines(desktop).links();
    const socket = first.open();
    const got: string[] = [];
    let opened = false;
    let closed: { code: number; reason: string } | null = null;
    socket.onopen = () => (opened = true);
    socket.onmessage = (ev) => got.push(String(ev.data));
    socket.onclose = (ev) => (closed = { code: ev.code, reason: ev.reason });
    await tick();
    expect(desktop.of("crew_machine_stream")).toEqual([{ machineId: "local" }]);
    expect(opened).toBe(true);
    desktop.emit("crew-machine-stream", { stream: 2, machine_id: "x", frame: "other" });
    desktop.emit("crew-machine-stream", { stream: 3, machine_id: "local", frame: '{"state":{}}' });
    expect(got).toEqual(['{"state":{}}']);
    socket.send(JSON.stringify({ token: "" }));
    desktop.emit("crew-machine-stream", { stream: 3, machine_id: "local", closed: "daemon went away" });
    expect(closed).toEqual({ code: 1006, reason: "daemon went away" });
    expect(desktop.listening("crew-machine-stream")).toBe(0);
  });

  it("closes the desktop stream through crew_machine_stream_close", async () => {
    const desktop = new FakeDesktop();
    desktop.handlers.crew_machine_stream = () => 5;
    const [first] = await desktopMachines(desktop).links();
    const socket = first.open();
    await tick();
    socket.close(1000, "closed by the app");
    await tick();
    expect(desktop.of("crew_machine_stream_close")).toEqual([{ stream: 5 }]);
    expect(desktop.listening("crew-machine-stream")).toBe(0);
  });

  it("opens the WebSocket stream of each paired machine", async () => {
    const urls: string[] = [];
    const sockets = new FakeSockets();
    const links = await pairedMachines([{ key: "box", name: "box", url: "https://box.example/", token: "tok-box", local: false }], server0.fetch, (url) => {
      urls.push(url);
      return sockets.open();
    }).links();
    links[0].open();
    expect(urls).toEqual(["wss://box.example/api/v1/stream"]);
  });

  it("tags the sessions of each machine in the hub with the daemon machine", async () => {
    const hub = await loadHub([link("local", machine("m-mac", "mac", ["ada"]), true), link("ssh:box", machine("m-box", "box", ["bob"]))]);
    const merged = withSessions(hub, {
      local: live([{ ID: "s1", name: "fix login" }]),
      "ssh:box": live([{ ID: "s2", name: "ship api" }]),
      gone: live([{ ID: "s3", name: "old" }]),
    });
    expect(merged.sessions.map((s) => [s.key, s.machine.id, s.item.ID])).toEqual([
      ["local", "m-mac", "s1"],
      ["ssh:box", "m-box", "s2"],
    ]);
  });

  it("keeps one stream client for each machine", () => {
    const sockets = new FakeSockets();
    const links: MachineLink[] = [
      { key: "a", name: "a", local: true, fetch: server0.fetch, token: "ta", open: sockets.open },
      { key: "b", name: "b", local: false, fetch: server0.fetch, token: "tb", open: sockets.open },
    ];
    const streams = new MachineStreams(links);
    streams.start();
    expect(sockets.opened).toHaveLength(2);
    sockets.opened[0].open();
    expect(sockets.opened[0].sent[0]).toEqual({ token: "ta" });
    sockets.opened[1].push({ state: state([{ ID: "s9", name: "nine" }]) });
    expect(streams.snapshots().b.state?.sessions.map((s) => s.ID)).toEqual(["s9"]);
    expect(streams.snapshots().a.status).toBe("connecting");
    streams.stop();
    expect(sockets.opened[0].closed).not.toBeNull();
  });
});

function env(name: string) {
  return { name, kind: "custom", parts: [], secrets: [], used_by: [] };
}

function machine(id: string, name: string, mates: string[], envs = ["work"]): FakeServer {
  return new FakeServer()
    .on("GET", "/api/v1/environments", { status: 200, body: { machine: { id, name }, identities: envs.map(env), found: [] } })
    .on("GET", "/api/v1/mates", { status: 200, body: { mates: mates.map((m) => ({ name: m, prompt: "", agent: "claude", enabled: true })), limits: {} } })
    .on("GET", "/api/v1/approvals", { status: 200, body: [{ ID: "a-" + id, SessionID: "s", Mate: mates[0] ?? "", Requester: "", Action: {}, At: "", State: "pending" }] });
}

function link(key: string, server: FakeServer, local = false): MachineLink {
  return { key, name: key, local, fetch: server.fetch, token: "t-" + key, open: new FakeSockets().open };
}

describe("machines hub", () => {
  it("keeps the machines that answer and marks the others not reachable", async () => {
    const down = new FakeServer().on("GET", "/api/v1/environments", new Error("connection refused"));
    const hub = await loadHub([link("local", machine("m-mac", "mac", ["ada"]), true), link("ssh:box", down)]);
    expect(hub.machines.map((m) => [m.key, m.state])).toEqual([
      ["local", "up"],
      ["ssh:box", "down"],
    ]);
    expect(hub.machines[1].error).toBe("machine not reachable");
    expect(hub.environments.map((e) => [e.machine.id, e.item.name])).toEqual([["m-mac", "work"]]);
    expect(hub.mates.map((m) => [m.key, m.item.name])).toEqual([["local", "ada"]]);
    expect(hub.approvals.map((a) => a.item.ID)).toEqual(["a-m-mac"]);
    expect(hub.tagged).toBe(true);
  });

  it("maps each app machine to the daemon machine id from the answer", async () => {
    const hub = await loadHub([link("local", machine("m-mac", "mac", ["ada"]), true), link("ssh:box", machine("m-box", "box", ["bob"]))]);
    expect(hub.machines.map((m) => [m.key, m.machine?.id, m.name])).toEqual([
      ["local", "m-mac", "mac"],
      ["ssh:box", "m-box", "box"],
    ]);
    expect(hub.mates.map((m) => m.machine.id)).toEqual(["m-mac", "m-box"]);
  });

  it("hides This Mac when no mate runs on it", async () => {
    const hub = await loadHub([link("local", machine("m-mac", "mac", []), true), link("ssh:box", machine("m-box", "box", ["bob"]))]);
    expect(hub.machines.map((m) => m.key)).toEqual(["ssh:box"]);
    expect(hub.environments.map((e) => e.machine.id)).toEqual(["m-box"]);
    expect(hub.tagged).toBe(false);
  });

  it("shows This Mac when it is the only machine, with no tag", async () => {
    const hub = await loadHub([link("local", machine("m-mac", "mac", []), true)]);
    expect(hub.machines.map((m) => m.key)).toEqual(["local"]);
    expect(hub.environments.map((e) => e.item.name)).toEqual(["work"]);
    expect(hub.tagged).toBe(false);
  });

  it("sends desktop requests through crew_machine_request with the app machine id", async () => {
    const desktop = new FakeDesktop();
    desktop.servers = [...desktop.servers, { id: "ssh:box", name: "box", kind: "ssh", detail: "over SSH" }];
    desktop.handlers.crew_machine_request = (args) => {
      if (args?.machineId === "ssh:box") {
        throw "machine not reachable";
      }
      const body = args?.path === "/api/v1/environments" ? { machine: { id: "m-mac", name: "mac" }, identities: [], found: [] } : args?.path === "/api/v1/mates" ? { mates: [{ name: "ada" }] } : [];
      return { status: 200, body: JSON.stringify(body) };
    };
    const hub = await loadHub(await desktopMachines(desktop).links());
    expect(hub.machines.map((m) => [m.key, m.state, m.machine?.id ?? null])).toEqual([
      ["local", "up", "m-mac"],
      ["ssh:box", "down", null],
    ]);
    expect(desktop.of("crew_machine_request")[0]).toEqual({ machineId: "local", method: "GET", path: "/api/v1/environments", body: null });
  });

  it("calls each paired machine directly with its own token", async () => {
    const server = machine("m-box", "box", ["bob"]);
    const seen: string[] = [];
    const fetchFn = (input: string, init?: RequestInit) => {
      seen.push(input);
      return server.fetch(input.replace("https://box.example", ""), init);
    };
    const links = await pairedMachines([{ key: "box", name: "box", url: "https://box.example/", token: "tok-box", local: false }], fetchFn).links();
    const hub = await loadHub(links);
    expect(hub.machines[0].state).toBe("up");
    expect(seen[0]).toBe("https://box.example/api/v1/environments");
    expect(server.headers[0].authorization).toBe("Bearer tok-box");
  });
});
