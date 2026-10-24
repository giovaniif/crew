import type { Automation, Mate } from "./api";
import type { ToneAxis } from "./faces";
import type { MateRow } from "./stream";

export type HistoryItem = { session: string; title: string; at: string };

export function mateHistory(row: MateRow): HistoryItem[] {
  return (row.conversations ?? []).filter((c) => c.history).map((c) => ({ session: c.session, title: c.name || c.session, at: c.started_at }));
}

export function shownConversation(row: MateRow, route: string): { session: string; history: boolean } {
  if (route !== "" && (row.conversations ?? []).some((c) => c.history && c.session === route)) {
    return { session: route, history: true };
  }
  return { session: row.conversation ?? "", history: false };
}

const sourceLine = /^Source: ([^\n]+)\n\n/;

export function messageSource(text: string): { tag: string; text: string } {
  const m = sourceLine.exec(text);
  if (!m) {
    return { tag: "App", text };
  }
  const tag = m[1].startsWith("Automation") ? "Automation" : m[1];
  return { tag, text: text.slice(m[0].length) };
}

function capital(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function replyHint(mate: string): string {
  return "Message " + capital(mate) + "…";
}

export function agentName(agent: string): string {
  return agent === "codex" ? "Codex" : agent === "claude" ? "Claude" : agent === "omp" ? "Pi" : agent;
}

export function harnessLabel(agent: string, model?: string): string {
  return [agentName(agent), model].filter(Boolean).join(" · ");
}

export function mateLine(env: string, agent: string, status: string): string {
  return [env, agentName(agent), status.toLowerCase()].filter(Boolean).join(" · ");
}

const handle = /^[a-z0-9][a-z0-9_-]*$/;

export function nameCheck(name: string, defs: Mate[]): { ok: boolean; text: string } {
  if (name === "") {
    return { ok: false, text: "" };
  }
  if (name.length > 32 || !handle.test(name)) {
    return { ok: false, text: "Use up to 32 letters, digits, - and _." };
  }
  if (defs.some((d) => d.name === name)) {
    return { ok: false, text: "A mate named " + name + " exists." };
  }
  return { ok: true, text: "name is free" };
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

export function mateRoute(hash: string): { name: string; thread: string; connect: boolean } {
  const [name = "", rest = ""] = hash.slice("#/mates/".length).split("/");
  const connect = rest === "~slack";
  return { name: decode(name), thread: connect ? "" : decode(rest), connect };
}

export function answersIn(channels: string[] | undefined): string {
  return [...(channels ?? []).map((c) => "#" + c), "DMs"].join(", ");
}

export type MateAutomation = { name: string; when: string };

export function mateAutomations(list: Automation[], mate: string): MateAutomation[] {
  return list
    .filter((a) => a.mate === mate)
    .map((a) => ({ name: a.name, when: a.schedule || (a.on?.length ? "on " + a.on.join(", ") : "manual") }))
    .sort((x, y) => x.name.localeCompare(y.name));
}

export function toneSteps(tones: ToneAxis[], tone: Record<string, number> | undefined): number[] {
  return tones.map((t) => {
    const v = tone?.[t.key];
    return v !== undefined && v >= 1 && v <= 5 ? v - 1 : 2;
  });
}

export function automationRoute(hash: string): { creating: boolean; mate: string } {
  const [path, query = ""] = hash.split("?");
  if (path !== "#/automations/new") {
    return { creating: false, mate: "" };
  }
  return { creating: true, mate: new URLSearchParams(query).get("mate") ?? "" };
}
