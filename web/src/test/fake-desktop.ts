import type { DesktopBridge } from "../desktopBridge";

export type FakeServerRow = { id: string; name: string; kind: "local" | "url" | "ssh"; detail: string };

type Handler = (args: Record<string, unknown> | undefined) => unknown;

export class FakeDesktop implements DesktopBridge {
  calls: { cmd: string; args?: Record<string, unknown> }[] = [];
  servers: FakeServerRow[] = [{ id: "local", name: "This computer", kind: "local", detail: "crew on this computer" }];
  selected = "local";
  firstRun = false;
  hosts: string[] = [];
  failures: Record<string, string> = {};
  pending: Record<string, Promise<void>> = {};
  handlers: Record<string, Handler> = {};

  invoke = async (cmd: string, args?: Record<string, unknown>) => {
    this.calls.push({ cmd, args });
    const wait = this.pending[cmd];
    if (wait) {
      await wait;
    }
    const failure = this.failures[cmd];
    if (failure !== undefined) {
      throw failure;
    }
    const handler = this.handlers[cmd];
    if (handler) {
      return handler(args);
    }
    switch (cmd) {
      case "crew_servers":
        return { servers: this.servers, selected: this.selected, first_run: this.firstRun };
      case "crew_ssh_hosts":
        return this.hosts;
      case "crew_server_crew":
        return { action: "current", server: "v0.1.0", app: "v0.1.0" };
      case "crew_server_add": {
        const kind = args?.kind as "url" | "ssh";
        const target = String(args?.target ?? "");
        const id = kind + ":" + target;
        this.servers = [...this.servers, { id, name: target, kind, detail: kind === "ssh" ? "over SSH" : target }];
        return id;
      }
      case "crew_server_remove":
        this.servers = this.servers.filter((s) => s.id !== args?.id);
        return null;
      case "crew_server_open":
        this.selected = String(args?.id);
        return null;
      default:
        return null;
    }
  };

  focused = () => true;
  onFocusChange = () => () => undefined;

  of(cmd: string) {
    return this.calls.filter((c) => c.cmd === cmd).map((c) => c.args);
  }
}
