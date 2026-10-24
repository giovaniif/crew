import { listApprovals, type Approval, type Authed, type EnvInfo, type Fetch, type Mate } from "./api";
import type { DesktopBridge } from "./desktopBridge";
import type { ServerListing } from "./servers";

export type MachineInfo = { id: string; name: string };

export type MachineLink = { key: string; name: string; local: boolean; fetch: Fetch; token: string };

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
      }));
    },
  };
}

export type PairedMachine = { key: string; name: string; url: string; token: string; local: boolean };

export function pairedMachines(paired: PairedMachine[], fetchFn: Fetch): Machines {
  return {
    async links() {
      return paired.map((p) => {
        const base = p.url.replace(/\/+$/, "");
        return { key: p.key, name: p.name, local: p.local, token: p.token, fetch: (path: string, init?: RequestInit) => fetchFn(base + path, init) };
      });
    },
  };
}
