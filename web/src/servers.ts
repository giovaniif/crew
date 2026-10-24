import type { DesktopBridge } from "./desktopBridge";

export type ServerKind = "local" | "url" | "ssh";
export type ServerRow = { id: string; name: string; kind: ServerKind; detail: string };
export type ServerListing = { servers: ServerRow[]; selected: string; first_run: boolean };

export type Where = ServerKind;
export type Step = "welcome" | "location" | "host" | "setup" | "workspace" | "done";

const order: Step[] = ["welcome", "location", "host", "setup", "workspace", "done"];

const titles: Record<Step, string> = {
  welcome: "Welcome",
  location: "Where agents run",
  host: "Server",
  setup: "Set up",
  workspace: "Workspace",
  done: "Done",
};

export function stepTitle(step: Step): string {
  return titles[step];
}

export function flowSteps(where: Where): Step[] {
  return order.filter((s) => s !== "host" || where !== "local");
}

export function nextStep(step: Step, where: Where): Step {
  const steps = flowSteps(where);
  const at = steps.indexOf(step);
  return steps[Math.min(at + 1, steps.length - 1)];
}

export function backStep(step: Step, where: Where): Step {
  const steps = flowSteps(where);
  const at = steps.indexOf(step);
  return steps[Math.max(at - 1, 0)];
}

export function primaryTitle(step: Step): string {
  if (step === "welcome") {
    return "Get started";
  }
  return step === "done" ? "Open crew" : "Continue";
}

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

  async workspace(id: string, path: string): Promise<void> {
    await call(this.desktop, "crew_server_workspace", { id, path });
  }
}
