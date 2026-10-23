import { keyAction, type KeyInput } from "./desktop";
import type { Session } from "./stream";

export type TermSize = { cols: number; rows: number };

export type Term = {
  readonly cols: number;
  readonly rows: number;
  open(host: HTMLElement): void;
  write(data: string | Uint8Array): void;
  onData(listener: (data: string) => void): void;
  onResize(listener: (size: TermSize) => void): void;
  keyFilter(allow: (e: KeyboardEvent) => boolean): void;
  fit(): void;
  focus(): void;
  dispose(): void;
};

export type TermSocket = {
  binaryType: BinaryType;
  send(data: string | ArrayBuffer | Uint8Array<ArrayBuffer>): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
};

export type TerminalEnv = {
  create: () => Term;
  open: (pane: string) => TermSocket;
};

export type PaneKind = "agent" | "shell" | "nvim";

export type TermStatus =
  | { kind: "idle" }
  | { kind: "opening" }
  | { kind: "connecting" }
  | { kind: "live" }
  | { kind: "gone" }
  | { kind: "paneClosed" }
  | { kind: "unavailable" }
  | { kind: "closed" }
  | { kind: "failed"; message: string };

export type ResolvePane = (session: string, kind: "shell" | "nvim") => Promise<string>;

export function keyForPane(e: KeyInput, mac: boolean): boolean {
  return !e.metaKey && keyAction(e, mac) === null;
}

export const closeNoPane = 4404;
export const closeTryLater = 1013;

const encoder = new TextEncoder();

export class TerminalEntry {
  readonly term: Term;
  readonly host: HTMLElement;
  status: TermStatus = { kind: "idle" };
  private socket: TermSocket | null = null;
  private pane: string | null = null;
  private closedPane: string | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private readonly env: TerminalEnv,
    private readonly token: string,
    private readonly resolve: ResolvePane,
    private session: Session,
    readonly kind: PaneKind,
    mac: boolean,
  ) {
    this.term = env.create();
    this.host = document.createElement("div");
    this.host.className = "term-host";
    this.term.open(this.host);
    this.term.keyFilter((e) => keyForPane(e, mac));
    this.term.onData((data) => {
      if (this.status.kind === "live") {
        this.socket?.send(encoder.encode(data));
      }
    });
    this.term.onResize(({ cols, rows }) => {
      if (this.status.kind === "live" && cols > 0 && rows > 0) {
        this.socket?.send(JSON.stringify({ size: { cols, rows } }));
      }
    });
  }

  update(session: Session): void {
    this.session = session;
    if (this.status.kind === "paneClosed" && session.Pane && session.Pane !== this.closedPane) {
      queueMicrotask(() => this.retry());
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): TermStatus => this.status;

  start(): void {
    if (this.status.kind === "idle") {
      void this.connect();
    }
  }

  retry(): void {
    if (this.status.kind !== "live" && this.status.kind !== "opening" && this.status.kind !== "connecting") {
      void this.connect();
    }
  }

  dispose(): void {
    this.drop();
    this.term.dispose();
    this.listeners.clear();
  }

  private set(status: TermStatus): void {
    this.status = status;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private async connect(): Promise<void> {
    let pane = this.pane;
    if (this.kind === "agent") {
      pane = this.session.Pane || null;
      if (!pane) {
        this.set({ kind: "failed", message: "This session has no terminal pane." });
        return;
      }
      if (pane === this.closedPane) {
        this.set({ kind: "paneClosed" });
        return;
      }
      this.closedPane = null;
    } else if (!pane) {
      this.set({ kind: "opening" });
      try {
        pane = await this.resolve(this.session.ID, this.kind);
      } catch (err) {
        this.set({ kind: "failed", message: err instanceof Error ? err.message : String(err) });
        return;
      }
    }
    this.pane = pane;
    this.open(pane);
  }

  private open(pane: string): void {
    this.drop();
    this.set({ kind: "connecting" });
    const socket = this.env.open(pane);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.onopen = () => {
      socket.send(JSON.stringify({ token: this.token, cols: this.term.cols, rows: this.term.rows }));
      this.set({ kind: "live" });
    };
    socket.onmessage = (ev) => this.receive(ev.data);
    socket.onerror = () => undefined;
    socket.onclose = (ev) => {
      if (socket !== this.socket) {
        return;
      }
      this.socket = null;
      if (ev.code === closeNoPane) {
        if (this.kind === "agent") {
          this.closedPane = pane;
          this.set({ kind: "paneClosed" });
          return;
        }
        this.pane = null;
        this.set({ kind: "gone" });
      } else if (ev.code === closeTryLater) {
        this.set({ kind: "unavailable" });
      } else {
        this.set({ kind: "closed" });
      }
    };
  }

  private receive(data: unknown): void {
    if (typeof data === "object" && data !== null && "byteLength" in data) {
      this.term.write(new Uint8Array(data as ArrayBuffer));
      return;
    }
    if (typeof data !== "string") {
      return;
    }
    let frame: unknown;
    try {
      frame = JSON.parse(data);
    } catch {
      return;
    }
    const screen = (frame as { screen?: { data?: unknown } } | null)?.screen;
    if (screen && typeof screen.data === "string") {
      this.term.write(screen.data);
    }
  }

  private drop(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close(1000, "closed by the app");
    }
  }
}

export class TerminalStore {
  private entries = new Map<string, TerminalEntry>();

  constructor(
    private readonly env: TerminalEnv,
    private readonly token: string,
    private readonly resolve: ResolvePane,
    private readonly mac = false,
  ) {}

  entry(session: Session, kind: PaneKind): TerminalEntry {
    const key = session.ID + "\u0000" + kind;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = new TerminalEntry(this.env, this.token, this.resolve, session, kind, this.mac);
      this.entries.set(key, entry);
    } else {
      entry.update(session);
    }
    return entry;
  }

  prune(sessions: string[]): void {
    const keep = new Set(sessions);
    for (const [key, entry] of this.entries) {
      if (!keep.has(key.split("\u0000")[0] ?? "")) {
        entry.dispose();
        this.entries.delete(key);
      }
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      entry.dispose();
    }
    this.entries.clear();
  }
}
