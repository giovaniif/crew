import type { Mate } from "./api";
import type { MateRow } from "./stream";

export type FaceState = "idle" | "working" | "thinking" | "needs" | "paused";

type Head = "sq" | "r4" | "circle" | "diamond";

export type Face = {
  id: string;
  name: string;
  accent: [string, string];
  head: Head;
  eye: string;
  mouth: string;
  ant?: boolean;
  tui: [string, string];
};

const A = {
  rosewater: ["#dc8a78", "#f5e0dc"],
  flamingo: ["#dd7878", "#f2cdcd"],
  pink: ["#ea76cb", "#f5c2e7"],
  mauve: ["#8839ef", "#cba6f7"],
  red: ["#d20f39", "#f38ba8"],
  peach: ["#fe640b", "#fab387"],
  yellow: ["#df8e1d", "#f9e2af"],
  green: ["#40a02b", "#a6e3a1"],
  teal: ["#179299", "#94e2d5"],
  sky: ["#04a5e5", "#89dceb"],
  sapphire: ["#209fb5", "#74c7ec"],
  lavender: ["#7287fd", "#b4befe"],
} satisfies Record<string, [string, string]>;

export const ACCENTS: string[] = Object.values(A).map((c) => c[0]);

export const FACES: Face[] = [
  { id: "pip", name: "Pip", accent: A.lavender, head: "sq", eye: "dot", mouth: "smile", tui: ["[● ●]", "[ ‿ ]"] },
  { id: "bolt", name: "Bolt", accent: A.sapphire, head: "r4", eye: "square", mouth: "flat", tui: ["[■ ■]", "[ ─ ]"] },
  { id: "sage", name: "Sage", accent: A.green, head: "circle", eye: "happy", mouth: "dot", tui: ["(^ ^)", "( · )"] },
  { id: "visor", name: "Visor", accent: A.teal, head: "sq", eye: "visor", mouth: "smile", tui: ["[▬▬▬]", "[ ‿ ]"] },
  { id: "iris", name: "Iris", accent: A.mauve, head: "circle", eye: "cyclops", mouth: "flat", tui: ["( ◉ )", "( ─ )"] },
  { id: "owl", name: "Owl", accent: A.peach, head: "r4", eye: "ring", mouth: "beak", tui: ["[◎ ◎]", "[ ▾ ]"] },
  { id: "dash", name: "Dash", accent: A.sky, head: "sq", eye: "bar", mouth: "wide", tui: ["[▮ ▮]", "[\\_/]"] },
  { id: "wink", name: "Wink", accent: A.pink, head: "circle", eye: "wink", mouth: "smirk", tui: ["(● ─)", "(  ‿)"] },
  { id: "prism", name: "Prism", accent: A.yellow, head: "diamond", eye: "diamond", mouth: "flat", tui: ["<◆ ◆>", "< ─ >"] },
  { id: "moss", name: "Moss", accent: A.rosewater, head: "r4", eye: "sleepy", mouth: "smile", tui: ["[◡ ◡]", "[ ‿ ]"] },
  { id: "beacon", name: "Beacon", accent: A.red, head: "sq", eye: "dot", mouth: "o", ant: true, tui: ["╷● ●╷", "╵ o ╵"] },
  { id: "quill", name: "Quill", accent: A.flamingo, head: "circle", eye: "tall", mouth: "smile", tui: ["(▯ ▯)", "( ‿ )"] },
];

export function faceOf(name: string, avatar?: string): Face {
  const byId = (id?: string) => FACES.find((f) => f.id === id);
  const sum = [...new TextEncoder().encode(name)].reduce((a, b) => a + b, 0);
  return byId(avatar) ?? byId(name) ?? FACES[sum % FACES.length];
}

export function faceColor(face: Face, color: string | undefined, dark: boolean): string {
  return color || face.accent[dark ? 1 : 0];
}

export function faceState(row: MateRow, approvals: string[]): FaceState {
  if (row.state === "paused" || row.guard) {
    return "paused";
  }
  const live = [...row.threads.map((t) => ({ state: t.state, ended: t.ended })), ...(row.conversations ?? [])].filter((c) => !c.ended);
  if (approvals.includes(row.name) || live.some((c) => c.state === "waiting" || c.state === "permission")) {
    return "needs";
  }
  return live.some((c) => c.state === "running") ? "working" : "idle";
}

export const stateWords: Record<FaceState, string> = { idle: "idle", working: "working", thinking: "thinking", needs: "needs you", paused: "paused" };

const INK = "#1e1e2e";

function head(h: Head, c: string, op: number): string {
  const s = ' fill="' + c + '"' + (op ? ' opacity="' + op + '"' : "");
  if (h === "circle") return '<circle cx="12" cy="12" r="12"' + s + "/>";
  if (h === "r4") return '<rect width="24" height="24" rx="5"' + s + "/>";
  if (h === "diamond") return '<rect x="2" y="2" width="20" height="20" rx="5" transform="rotate(45 12 12)"' + s + "/>";
  return '<rect width="24" height="24" rx="8"' + s + "/>";
}

function eyes(e: string, st: FaceState, dx: number, dy: number): string {
  const y = 10.5 + dy;
  if (st === "paused") {
    return '<path d="M6.8 ' + (y + 0.5) + "h3.4M13.8 " + (y + 0.5) + 'h3.4" stroke="' + INK + '" stroke-width="1.6" stroke-linecap="round"/>';
  }
  const k = st === "needs" ? 1.2 : 1;
  const sk = ' stroke="' + INK + '" stroke-width="1.6" stroke-linecap="round"';
  if (e === "visor") {
    return '<rect x="' + (6 + dx) + '" y="' + (y - 1.5 * k) + '" width="12" height="' + 3 * k + '" rx="1.5"/><rect x="' + (13 + dx * 2) + '" y="' + (y - 0.6) + '" width="3" height="1.2" rx=".6" fill="#fff" opacity=".7"/>';
  }
  if (e === "cyclops") {
    return '<circle cx="' + (12 + dx) + '" cy="' + y + '" r="' + 3.6 * k + '"/><circle cx="' + (13 + dx) + '" cy="' + (y - 1) + '" r="1.1" fill="#fff" opacity=".8"/>';
  }
  let o = "";
  [8.5, 15.5].forEach((x0, i) => {
    const x = x0 + dx;
    if (e === "dot") o += '<circle cx="' + x + '" cy="' + y + '" r="' + 1.7 * k + '"/>';
    if (e === "square") o += '<rect x="' + (x - 1.6 * k) + '" y="' + (y - 1.6 * k) + '" width="' + 3.2 * k + '" height="' + 3.2 * k + '" rx=".6"/>';
    if (e === "happy") o += '<path d="M' + (x - 2) + " " + (y + 1) + 'q2 -3 4 0" fill="none"' + sk + "/>";
    if (e === "ring") o += '<circle cx="' + x + '" cy="' + y + '" r="' + 2.6 * k + '" fill="none" stroke="' + INK + '" stroke-width="1.3"/><circle cx="' + (x + 0.5) + '" cy="' + y + '" r="1"/>';
    if (e === "bar") o += '<rect x="' + (x - 0.9) + '" y="' + (y - 2.4 * k) + '" width="1.8" height="' + 4.8 * k + '" rx=".9"/>';
    if (e === "tall") o += '<rect x="' + (x - 1.4) + '" y="' + (y - 2.2 * k) + '" width="2.8" height="' + 4.4 * k + '" rx="1.4"/>';
    if (e === "diamond") o += '<rect x="' + (x - 1.3 * k) + '" y="' + (y - 1.3 * k) + '" width="' + 2.6 * k + '" height="' + 2.6 * k + '" transform="rotate(45 ' + x + " " + y + ')"/>';
    if (e === "sleepy") o += '<path d="M' + (x - 2) + " " + (y - 0.5) + 'a2 2 0 0 0 4 0z"/>';
    if (e === "wink") o += i === 0 ? '<circle cx="' + x + '" cy="' + y + '" r="' + 1.7 * k + '"/>' : '<path d="M' + (x - 1.8) + " " + y + 'h3.6"' + sk + "/>";
  });
  return o;
}

function mouth(m: string, st: FaceState): string {
  const y = 16.2;
  const sk = ' fill="none" stroke="' + INK + '" stroke-width="1.6" stroke-linecap="round"';
  if (st === "needs") return '<circle cx="12" cy="' + (y + 0.3) + '" r="1.6"/>';
  if (st === "thinking") return '<path d="M10.5 ' + y + 'h3"' + sk + "/>";
  if (st === "paused") return '<path d="M10.5 ' + y + 'h3"' + sk + ' opacity=".7"/>';
  if (m === "smile") return '<path d="M9.5 ' + (y - 0.6) + 'q2.5 2.4 5 0"' + sk + "/>";
  if (m === "flat") return '<path d="M10 ' + y + 'h4"' + sk + "/>";
  if (m === "dot") return '<circle cx="12" cy="' + y + '" r="1"/>';
  if (m === "beak") return '<path d="M10.6 ' + (y - 1.2) + 'h2.8l-1.4 2z"/>';
  if (m === "wide") return '<path d="M8.5 ' + (y - 1) + 'q3.5 3.2 7 0"' + sk + "/>";
  if (m === "smirk") return '<path d="M10.5 ' + y + 'q2.2 1 4 -1"' + sk + "/>";
  return '<circle cx="12" cy="' + y + '" r="1.3" fill="none" stroke="' + INK + '" stroke-width="1.4"/>';
}

function ring(st: FaceState, c: string): string {
  if (st === "thinking") {
    return '<circle cx="12" cy="12" r="14.2" fill="none" stroke="' + c + '" stroke-width="1.4" stroke-dasharray="0.1 3.6" stroke-linecap="round" class="cf-spin-slow"/>';
  }
  if (st === "working") {
    return '<circle cx="12" cy="12" r="14.2" fill="none" stroke="' + c + '" stroke-width="1.6" stroke-dasharray="22 67" stroke-linecap="round" class="cf-spin"/>';
  }
  if (st === "needs") {
    return '<circle cx="12" cy="12" r="14.2" fill="none" stroke="var(--cf-attn,#fe640b)" stroke-width="1.8"/><circle cx="22" cy="2" r="3.2" fill="var(--cf-attn,#fe640b)" stroke="var(--cf-bg,#eff1f5)" stroke-width="1.4"/>';
  }
  return "";
}

export function faceSvg(f: Face, st: FaceState, color: string, px: number): string {
  const think = st === "thinking";
  const ant = f.ant
    ? '<path d="M12 0v-2.4" stroke="' + color + '" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="-2.6" r="1.4" fill="' + color + '"/>'
    : "";
  const body = head(f.head, color, st === "paused" ? 0.45 : 0) + ant + '<g fill="' + INK + '">' + eyes(f.eye, st, think ? 0.9 : 0, think ? -0.9 : 0) + mouth(f.mouth, st) + "</g>";
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 32 32" width="' + px + '" height="' + px + '" role="img" aria-label="' + f.name + " " + st + '">' + body + ring(st, color) + "</svg>"
  );
}

export function faceGlyph(f: Face, st: FaceState): [string, string] {
  const [a, b] = f.tui;
  const ends = (s: string, mid: string) => [...s][0] + mid + [...s][4];
  if (st === "paused") return [ends(a, "─ ─"), ends(b, " ─ ")];
  if (st === "thinking") return [ends(a, "˙ ˙"), ends(b, " ─ ") + " …"];
  if (st === "working") return [a, b + " ⠋"];
  if (st === "needs") return [a + " !", ends(b, " o ")];
  return [a, b];
}

export type ToneAxis = { key: string; low: string; high: string; steps: string[] };

export function toneLines(tones: ToneAxis[], steps: number[]): string[] {
  return tones.map((t, i) => t.steps[steps[i] ?? 2] ?? "").filter((s) => s !== "");
}

export function toneOf(tones: ToneAxis[], steps: number[]): Record<string, number> {
  return Object.fromEntries(tones.map((t, i) => [t.key, (steps[i] ?? 2) + 1]));
}

export type MateCard = { name: string; agent: string; tagline: string; live: number; liveLabel: string; status: string; face: FaceState; row: MateRow; def?: Mate };

export type MateSource = "all" | "live" | "claude" | "codex";

export function mateTagline(prompt: string): string {
  const text = prompt.trim();
  return text.split("\n\n")[0];
}

export function mateCard(row: MateRow, def: Mate | undefined, asking: string[]): MateCard {
  const live = [...row.threads.map((t) => ({ name: t.session || t.session_id, state: t.state, ended: t.ended })), ...(row.conversations ?? [])].filter(
    (c) => !c.ended,
  );
  const face = faceState(row, asking);
  let status = "Idle";
  const working = live.find((c) => c.state === "running");
  const done = live.find((c) => c.state === "done");
  if (row.guard) {
    status = "Held · " + row.guard.replaceAll("_", " ");
  } else if (row.state === "paused" || def?.enabled === false) {
    status = "Paused";
  } else if (face === "needs") {
    status = "Needs you";
  } else if (working) {
    status = "Working on " + working.name;
  } else if (done) {
    status = "Finished " + done.name;
  }
  return {
    name: row.name,
    agent: def?.agent ?? "",
    tagline: def ? mateTagline(def.prompt) : "",
    live: live.length,
    liveLabel: live.length === 0 ? "No live chats" : live.length + " live",
    status,
    face: def?.enabled === false ? "paused" : face,
    row,
    def,
  };
}

export function inSource(card: MateCard, source: MateSource): boolean {
  if (source === "all") {
    return true;
  }
  return source === "live" ? card.live > 0 : card.agent === source;
}

export function gallery(cards: MateCard[], source: MateSource, search: string): MateCard[] {
  const q = search.trim().toLowerCase();
  return cards.filter((c) => inSource(c, source) && (q === "" || [c.name, c.tagline].some((t) => t.toLowerCase().includes(q))));
}

export type MemoryMeter = { fraction: number; full: boolean; label: string };

export function memoryMeter(text: string, limit: number): MemoryMeter {
  const bytes = new TextEncoder().encode(text).length;
  const cap = Math.max(limit, 1);
  const kb = Math.floor(cap / 1024) + " KB";
  let label = Math.floor(((bytes * 10 + 512) / 1024) / 10) + "." + (Math.floor((bytes * 10 + 512) / 1024) % 10) + " KB of " + kb;
  if (bytes === 0) {
    label = "Empty · " + kb + " limit";
  } else if (bytes < 1024) {
    label = bytes + " bytes of " + kb;
  }
  return { fraction: Math.min(1, bytes / cap), full: bytes > cap, label };
}
