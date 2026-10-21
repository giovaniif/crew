import { act } from "@testing-library/react";
import type { Term, TermSize, TermSocket, TerminalEnv } from "../terminal";

const decoder = new TextDecoder();

export class FakeTerm implements Term {
  cols = 120;
  rows = 40;
  text = "";
  host: HTMLElement | null = null;
  disposed = false;
  fits = 0;
  private dataListener: ((data: string) => void) | null = null;
  private resizeListener: ((size: TermSize) => void) | null = null;
  private allow: ((e: KeyboardEvent) => boolean) | null = null;
  private screen = document.createElement("pre");

  open(host: HTMLElement): void {
    this.host = host;
    this.screen.setAttribute("data-testid", "term-screen");
    host.appendChild(this.screen);
  }

  write(data: string | Uint8Array): void {
    this.text += typeof data === "string" ? data : decoder.decode(data);
    this.screen.textContent = this.text;
  }

  onData(listener: (data: string) => void): void {
    this.dataListener = listener;
  }

  onResize(listener: (size: TermSize) => void): void {
    this.resizeListener = listener;
  }

  keyFilter(allow: (e: KeyboardEvent) => boolean): void {
    this.allow = allow;
  }

  fit(): void {
    this.fits += 1;
  }

  focus(): void {}

  dispose(): void {
    this.disposed = true;
  }

  type(data: string): void {
    act(() => this.dataListener?.(data));
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    act(() => this.resizeListener?.({ cols, rows }));
  }

  passes(init: KeyboardEventInit): boolean {
    return this.allow ? this.allow(new KeyboardEvent("keydown", init)) : true;
  }
}

export class FakeTermSocket implements TermSocket {
  binaryType: BinaryType = "blob";
  readonly frames: unknown[] = [];
  readonly keys: string[] = [];
  closed: { code?: number; reason?: string } | null = null;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  constructor(readonly pane: string) {}

  send(data: string | ArrayBuffer | Uint8Array): void {
    if (typeof data === "string") {
      this.frames.push(JSON.parse(data));
      return;
    }
    this.keys.push(decoder.decode(data));
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }

  open(): void {
    act(() => this.onopen?.(new Event("open")));
  }

  screen(data: string, cols = 120, rows = 40): void {
    const frame = { screen: { pane: this.pane, window: "@1", cols, rows, cursor: { x: 0, y: 0, visible: true }, data } };
    act(() => this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(frame) })));
  }

  output(text: string): void {
    const bytes = new TextEncoder().encode(text);
    act(() => this.onmessage?.(new MessageEvent("message", { data: bytes.buffer })));
  }

  drop(code: number, reason = ""): void {
    act(() => this.onclose?.(new CloseEvent("close", { code, reason })));
  }
}

export class FakeTerminals {
  readonly terms: FakeTerm[] = [];
  readonly sockets: FakeTermSocket[] = [];

  readonly env: TerminalEnv = {
    create: () => {
      const term = new FakeTerm();
      this.terms.push(term);
      return term;
    },
    open: (pane) => {
      const socket = new FakeTermSocket(pane);
      this.sockets.push(socket);
      return socket;
    },
  };

  socket(pane: string): FakeTermSocket {
    const found = this.sockets.filter((s) => s.pane === pane);
    const socket = found[found.length - 1];
    if (!socket) {
      throw new Error("no socket for pane " + pane);
    }
    return socket;
  }
}
