import type { Worktree } from "./stream";

const loopback = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

function portNumber(text: string): number | null {
  if (!/^\d+$/.test(text)) {
    return null;
  }
  const n = Number(text);
  return n >= 1 && n <= 65535 ? n : null;
}

function parse(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

export function browserAddress(input: string, host: string): string | null {
  const text = input.trim();
  if (text === "" || /\s/.test(text)) {
    return null;
  }
  const port = portNumber(text.startsWith(":") ? text.slice(1) : text);
  if (port !== null) {
    return "http://" + host + ":" + port + "/";
  }
  if (text.includes("://")) {
    const url = parse(text);
    if (!url || (url.protocol !== "http:" && url.protocol !== "https:") || url.hostname === "") {
      return null;
    }
    return text;
  }
  const slash = text.indexOf("/");
  const authority = slash === -1 ? text : text.slice(0, slash);
  const path = slash === -1 ? "/" : text.slice(slash);
  const name = authority.split(":")[0];
  if (loopback.has(name.toLowerCase())) {
    const rest = authority.slice(name.length);
    if (rest !== "" && portNumber(rest.slice(1)) === null) {
      return null;
    }
    return "http://" + host + rest + path;
  }
  if (!name.includes(".") || name.startsWith(".") || name.endsWith(".") || !parse("https://" + text)) {
    return null;
  }
  return "https://" + text;
}

export type PortLink = { port: number; title: string; url: string };

export function portLinks(session: string, worktrees: Worktree[], host: string): PortLink[] {
  const seen = new Set<number>();
  const links: PortLink[] = [];
  for (const w of worktrees) {
    if (w.SessionID !== session) {
      continue;
    }
    for (const p of w.Ports ?? []) {
      if (seen.has(p.Port)) {
        continue;
      }
      seen.add(p.Port);
      links.push({ port: p.Port, title: w.Repo + " :" + p.Port, url: "http://" + host + ":" + p.Port + "/" });
    }
  }
  return links.sort((a, b) => a.port - b.port);
}

export function tabLabel(url: string): string {
  const parsed = url === "" ? null : parse(url);
  if (!parsed || parsed.hostname === "") {
    return "New tab";
  }
  return parsed.host;
}
