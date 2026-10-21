import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { Term, TermSize, TerminalEnv } from "./terminal";

function palette(): ITheme {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue("--term-" + name).trim() || undefined;
  return {
    background: token("background"),
    foreground: token("foreground"),
    cursor: token("cursor"),
    selectionBackground: token("selection"),
    black: token("black"),
    red: token("red"),
    green: token("green"),
    yellow: token("yellow"),
    blue: token("blue"),
    magenta: token("magenta"),
    cyan: token("cyan"),
    white: token("white"),
    brightBlack: token("bright-black"),
    brightRed: token("red"),
    brightGreen: token("green"),
    brightYellow: token("yellow"),
    brightBlue: token("blue"),
    brightMagenta: token("magenta"),
    brightCyan: token("cyan"),
    brightWhite: token("bright-white"),
  };
}

class XTerm implements Term {
  private readonly term = new Terminal({
    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    fontSize: 13,
    scrollback: 10000,
    cursorBlink: true,
    allowProposedApi: true,
    theme: palette(),
  });
  private readonly fitter = new FitAddon();

  constructor() {
    this.term.loadAddon(this.fitter);
  }

  get cols(): number {
    return this.term.cols;
  }

  get rows(): number {
    return this.term.rows;
  }

  open(host: HTMLElement): void {
    this.term.open(host);
  }

  write(data: string | Uint8Array): void {
    this.term.write(data);
  }

  onData(listener: (data: string) => void): void {
    this.term.onData(listener);
  }

  onResize(listener: (size: TermSize) => void): void {
    this.term.onResize(listener);
  }

  keyFilter(allow: (e: KeyboardEvent) => boolean): void {
    this.term.attachCustomKeyEventHandler(allow);
  }

  fit(): void {
    const host = this.term.element?.parentElement;
    if (!host || !host.isConnected || host.clientWidth === 0 || host.clientHeight === 0) {
      return;
    }
    this.fitter.fit();
  }

  focus(): void {
    this.term.focus();
  }

  dispose(): void {
    this.term.dispose();
  }
}

export function browserTerminal(location: Location): TerminalEnv {
  const base = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/v1/terminal/";
  return {
    create: () => new XTerm(),
    open: (pane) => new WebSocket(base + encodeURIComponent(pane)),
  };
}
