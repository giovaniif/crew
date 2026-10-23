import type { Mate } from "./api";
import type { AgentState, MateRow } from "./stream";

export type ThreadSource = "slack" | "dm" | "app";

export type ThreadItem = {
  session: string;
  title: string;
  tag: string;
  source: ThreadSource;
  state: AgentState;
  ended: boolean;
  url?: string;
  at?: string;
};

const tags: Record<ThreadSource, string> = { slack: "Slack channel", dm: "Slack DM", app: "App" };

export function mateThreads(row: MateRow): ThreadItem[] {
  const slack: ThreadItem[] = row.threads.map((t) => {
    const source: ThreadSource = t.channel.startsWith("D") ? "dm" : "slack";
    return { session: t.session_id, title: t.session || t.session_id, tag: tags[source], source, state: t.state, ended: t.ended, url: t.url || undefined };
  });
  const app: ThreadItem[] = (row.conversations ?? []).map((c) => ({
    session: c.session,
    title: c.name || c.session,
    tag: tags.app,
    source: "app",
    state: c.state,
    ended: c.ended,
    at: c.started_at,
  }));
  const all = [...slack, ...app];
  return [...all.filter((t) => !t.ended), ...all.filter((t) => t.ended)];
}

export function threadSearch(items: ThreadItem[], query: string): ThreadItem[] {
  const q = query.trim().toLowerCase();
  if (q === "") {
    return items;
  }
  return items.filter((t) => t.title.toLowerCase().includes(q) || t.tag.toLowerCase().includes(q));
}

function capital(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function replyHint(item: ThreadItem, mate: string): string {
  return item.source === "app" ? "Message " + capital(mate) + "…" : "Reply in this thread. It also posts to Slack.";
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
