import type { DesktopBridge } from "./desktopBridge";
import type { Completion } from "./pathSuggest";

export type ServerKind = "local" | "url" | "ssh";
export type ServerRow = { id: string; name: string; kind: ServerKind; detail: string };
export type ServerListing = { servers: ServerRow[]; selected: string; first_run: boolean };

export type Where = ServerKind;
export function sshTarget(text: string): string | null {
  const target = text.trim();
  if (target === "" || target.startsWith("-") || /[\s'"]/.test(target)) {
    return null;
  }
  return target;
}

function message(err: unknown): string {
  if (typeof err === "string") {
    return err;
  }
  return err instanceof Error ? err.message : String(err);
}

async function call<T>(desktop: DesktopBridge, cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return (await desktop.invoke(cmd, args)) as T;
  } catch (err) {
    throw new Error(message(err));
  }
}

export type RemoteCrew = { action: "current" | "install" | "upgrade"; server: string | null; app: string };

export class Servers {
  constructor(private desktop: DesktopBridge) {}

  list(): Promise<ServerListing> {
    return call(this.desktop, "crew_servers");
  }

  async hosts(): Promise<string[]> {
    return (await call<string[] | null>(this.desktop, "crew_ssh_hosts")) ?? [];
  }

  crew(target: string): Promise<RemoteCrew> {
    return call(this.desktop, "crew_server_crew", { target });
  }

  async install(target: string): Promise<void> {
    await call(this.desktop, "crew_server_install", { target });
  }

  add(kind: "url" | "ssh", target: string, code = ""): Promise<string> {
    return call(this.desktop, "crew_server_add", { kind, target, code });
  }

  async open(id: string): Promise<void> {
    await call(this.desktop, "crew_server_open", { id });
  }

  async remove(id: string): Promise<void> {
    await call(this.desktop, "crew_server_remove", { id });
  }

  async fix(id: string): Promise<void> {
    await call(this.desktop, "crew_server_fix", { id });
  }

  async pickFolder(near?: string): Promise<string | null> {
    return (await call<string | null>(this.desktop, "crew_pick_folder", { near: near ?? null })) ?? null;
  }

  complete(id: string, path: string): Promise<Completion> {
    return call(this.desktop, "crew_server_complete", { id, path });
  }

  async workspace(id: string, path: string): Promise<void> {
    await call(this.desktop, "crew_server_workspace", { id, path });
  }
}
