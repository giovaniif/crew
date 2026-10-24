import { listApprovals, type Approval, type Authed, type EnvInfo, type Fetch, type Mate } from "./api";
import type { DesktopBridge } from "./desktopBridge";
import type { ServerListing } from "./servers";
import { StreamClient, type OpenSocket, type Session, type SocketLike, type StreamSnapshot } from "./stream";

export type MachineInfo = { id: string; name: string };

export type MachineLink = { key: string; name: string; local: boolean; fetch: Fetch; token: string; open: OpenSocket };

export type Machines = { links(): Promise<MachineLink[]> };

export type MachineState = {
  key: string;
  name: string;
  local: boolean;
  machine: MachineInfo | null;
  state: "up" | "down";
  error?: string;
};

export type Tagged<T> = { key: string; machine: MachineInfo; item: T };

export type Hub = {
  machines: MachineState[];
  environments: Tagged<EnvInfo>[];
  mates: Tagged<Mate>[];
  approvals: Tagged<Approval>[];
  sessions: Tagged<Session>[];
  tagged: boolean;
};

export type EnvironmentList = { machine: MachineInfo; identities: EnvInfo[] | null; found?: unknown };

export type MachineAnswer = {
  link: MachineLink;
  environments: EnvironmentList | null;
  mates: Mate[];
  approvals: Approval[];
};

export const notReachable = "machine not reachable";

function authed(link: MachineLink): Authed {
  return { fetch: link.fetch, token: link.token };
}

function get<T>(link: MachineLink, path: string): Promise<T> {
  return link.fetch(path, { cache: "no-store", headers: { Authorization: "Bearer " + link.token } }).then(async (res) => {
    if (!res.ok) {
      throw new Error(notReachable);
    }
    return (await res.json()) as T;
  });
}

async function answer(link: MachineLink): Promise<MachineAnswer> {
  const [environments, mates, approvals] = await Promise.allSettled([
    get<EnvironmentList>(link, "/api/v1/environments"),
    get<{ mates: Mate[] | null }>(link, "/api/v1/mates"),
    listApprovals(authed(link)),
  ]);
  return {
    link,
    environments: environments.status === "fulfilled" && environments.value?.machine ? environments.value : null,
    mates: mates.status === "fulfilled" ? (mates.value?.mates ?? []) : [],
    approvals: approvals.status === "fulfilled" ? approvals.value : [],
  };
}

function tag<T>(key: string, machine: MachineInfo, items: T[]): Tagged<T>[] {
  return items.map((item) => ({ key, machine, item }));
}

export function mergeHub(answers: MachineAnswer[]): Hub {
  const visible = answers.filter((a) => !(answers.length > 1 && a.link.local && a.environments && a.mates.length === 0));
  const machines: MachineState[] = visible.map((a) => ({
    key: a.link.key,
    name: a.environments?.machine.name || a.link.name,
    local: a.link.local,
    machine: a.environments?.machine ?? null,
    state: a.environments ? "up" : "down",
    ...(a.environments ? {} : { error: notReachable }),
  }));
  const up = visible.filter((a): a is MachineAnswer & { environments: EnvironmentList } => a.environments !== null);
  return {
    machines,
    environments: up.flatMap((a) => tag(a.link.key, a.environments.machine, a.environments.identities ?? [])),
    mates: up.flatMap((a) => tag(a.link.key, a.environments.machine, a.mates)),
    approvals: up.flatMap((a) => tag(a.link.key, a.environments.machine, a.approvals)),
    sessions: [],
    tagged: machines.length > 1,
  };
}

export async function loadHub(links: MachineLink[]): Promise<Hub> {
  return mergeHub(await Promise.all(links.map(answer)));
}

type MachineReply = { status: number; body: string };

export function desktopFetch(desktop: DesktopBridge, machineId: string): Fetch {
  return async (path, init) => {
    try {
      const reply = (await desktop.invoke("crew_machine_request", {
        machineId,
        method: init?.method ?? "GET",
        path,
        body: typeof init?.body === "string" ? init.body : null,
      })) as MachineReply;
      return new Response(reply.body || null, { status: reply.status, headers: { "Content-Type": "application/json" } });
    } catch (err) {
      throw new Error(typeof err === "string" ? err : err instanceof Error ? err.message : String(err));
    }
  };
}

export function desktopMachines(desktop: DesktopBridge): Machines {
  return {
    async links() {
      const listing = (await desktop.invoke("crew_servers")) as ServerListing;
      return listing.servers.map((s) => ({
        key: s.id,
        name: s.name,
        local: s.kind === "local",
        fetch: desktopFetch(desktop, s.id),
        token: "",
        open: desktopSocket(desktop, s.id),
      }));
    },
  };
}

export type PairedMachine = { key: string; name: string; url: string; token: string; local: boolean };

function browserSocket(url: string): SocketLike {
  return new WebSocket(url);
}

export function pairedMachines(paired: PairedMachine[], fetchFn: Fetch, socket: (url: string) => SocketLike = browserSocket): Machines {
  return {
    async links() {
      return paired.map((p) => {
        const base = p.url.replace(/\/+$/, "");
        const stream = base.replace(/^http/, "ws") + "/api/v1/stream";
        return {
          key: p.key,
          name: p.name,
          local: p.local,
          token: p.token,
          fetch: (path: string, init?: RequestInit) => fetchFn(base + path, init),
          open: () => socket(stream),
        };
      });
    },
  };
}

export const streamEvent = "crew-machine-stream";

type StreamEvent = { stream: number; machine_id: string; frame?: string; closed?: string };

export function desktopSocket(desktop: DesktopBridge, machineId: string): OpenSocket {
  return () => {
    let stream: number | null = null;
    let done = false;
    let off: (() => void) | null = null;
    const early: StreamEvent[] = [];
    const socket: SocketLike = {
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: () => undefined,
      close: () => {
        if (done) {
          return;
        }
        done = true;
        off?.();
        if (stream !== null) {
          void desktop.invoke("crew_machine_stream_close", { stream }).catch(() => undefined);
        }
      },
    };
    const finish = (reason: string) => {
      if (done) {
        return;
      }
      done = true;
      off?.();
      socket.onclose?.(new CloseEvent("close", { code: 1006, reason }));
    };
    const deliver = (event: StreamEvent) => {
      if (done || event.stream !== stream) {
        return;
      }
      if (event.frame !== undefined) {
        socket.onmessage?.(new MessageEvent("message", { data: event.frame }));
      }
      if (event.closed !== undefined) {
        finish(event.closed);
      }
    };
    void (async () => {
      try {
        if (!desktop.listen) {
          throw new Error("this app cannot listen to events");
        }
        const unlisten = await desktop.listen(streamEvent, (payload) => {
          const event = payload as StreamEvent;
          if (stream === null) {
            early.push(event);
          } else {
            deliver(event);
          }
        });
        off = unlisten;
        if (done) {
          unlisten();
          return;
        }
        const id = (await desktop.invoke("crew_machine_stream", { machineId })) as number;
        stream = id;
        if (done) {
          void desktop.invoke("crew_machine_stream_close", { stream: id }).catch(() => undefined);
          return;
        }
        socket.onopen?.(new Event("open"));
        for (const event of early.splice(0)) {
          deliver(event);
        }
      } catch (err) {
        finish(typeof err === "string" ? err : err instanceof Error ? err.message : String(err));
      }
    })();
    return socket;
  };
}

export class MachineStreams {
  private readonly clients: Map<string, StreamClient>;

  constructor(links: MachineLink[]) {
    this.clients = new Map(links.map((l) => [l.key, new StreamClient({ open: l.open, token: l.token })]));
  }

  start(): void {
    for (const client of this.clients.values()) {
      client.start();
    }
  }

  stop(): void {
    for (const client of this.clients.values()) {
      client.stop();
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    const offs = [...this.clients.values()].map((c) => c.subscribe(listener));
    return () => offs.forEach((off) => off());
  };

  snapshots(): Record<string, StreamSnapshot> {
    return Object.fromEntries([...this.clients].map(([key, c]) => [key, c.snapshot()]));
  }
}

export function withSessions(hub: Hub, snapshots: Record<string, StreamSnapshot>): Hub {
  const sessions = hub.machines.flatMap((m) => {
    const state = snapshots[m.key]?.state;
    return m.machine && state ? tag(m.key, m.machine, state.sessions) : [];
  });
  return { ...hub, sessions };
}
