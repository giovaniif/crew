import type { EnvInfo, EnvSecret } from "./api";
import type { ServerListing } from "./servers";

export const customParts = ["git", "ssh", "github", "claude", "codex", "pi"];

export const piKeys = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "XAI_API_KEY",
  "MISTRAL_API_KEY",
];

const managed = new Set(["GH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", ...piKeys]);

export type AccountRow = {
  part: string;
  title: string;
  sub: string;
  keys: string[];
  set: boolean;
  setKeys: string[];
};

const accounts: Omit<AccountRow, "set" | "setKeys">[] = [
  {
    part: "claude",
    title: "Claude",
    sub: "",
    keys: ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"],
  },
  {
    part: "codex",
    title: "Codex",
    sub: "OpenAI API key",
    keys: ["OPENAI_API_KEY"],
  },
  { part: "pi", title: "Pi", sub: "API key", keys: piKeys },
];

export function isLocal(e: EnvInfo): boolean {
  return e.kind === "local" && (e.name === "local" || e.name === "yours");
}

export function identitySub(e: EnvInfo): string {
  if (e.kind === "local") {
    return e.used_by.length === 0 ? "not used" : e.used_by.join(", ");
  }
  if (e.used_by.length === 0) {
    return "Separate identity";
  }
  return "Separate identity · " + (e.used_by.length === 1 ? e.used_by[0] : usedLabel(e.used_by.length));
}

export function machineTitle(local: boolean, name: string): string {
  return local ? "This Mac" : name;
}

export function machineWhere(local: boolean, name: string): string {
  return local ? "this Mac" : name;
}

export function machineAddress(key: string): string {
  return key.startsWith("ssh:") ? key.slice(4) : key.startsWith("url:") ? key.slice(4) : "";
}

export function envOrder(envs: EnvInfo[]): EnvInfo[] {
  return [...envs.filter(isLocal), ...envs.filter((e) => !isLocal(e))];
}

export function envTitle(e: EnvInfo, machine = "this Mac"): string {
  return isLocal(e) ? "Local (" + machine + ")" : e.name;
}

export function machineName(listing: ServerListing | null, pageHost: string): string {
  const row = listing?.servers.find((s) => s.id === listing.selected);
  if (row) {
    return row.kind === "local" ? "this Mac" : row.name;
  }
  const host = pageHost.replace(/:\d+$/, "");
  if (host === "" || host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost")) {
    return "this Mac";
  }
  return /^\d+(\.\d+){3}$/.test(host) ? host : host.split(".")[0];
}

const partWords: Record<string, string> = {
  ssh: "own SSH key",
  github: "GitHub token",
  claude: "Claude login",
  codex: "Codex login",
  pi: "Pi login",
};

export function envParts(e: EnvInfo): string {
  return e.parts
    .map((p) => (p === "git" ? (e.git_email ? "git as " + e.git_email : "own git name") : (partWords[p] ?? p)))
    .join(", ");
}

export function envLetter(e: EnvInfo): string {
  return isLocal(e) ? "L" : e.name.charAt(0).toUpperCase();
}

export function usedLabel(n: number): string {
  return n === 1 ? "1 mate" : n + " mates";
}

export function envSub(e: EnvInfo): string {
  const kind = e.kind === "local" ? "Your logins" : "Custom";
  return (
    kind +
    " · " +
    (e.used_by.length === 0 ? "not used" : usedLabel(e.used_by.length))
  );
}

export function matesText(names: string[]): string {
  if (names.length === 0) {
    return "No mate";
  }
  if (names.length === 1) {
    return names[0];
  }
  return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

function isSet(e: EnvInfo, name: string): boolean {
  return e.secrets.some((s) => s.name === name && s.set);
}

export function accountRows(e: EnvInfo): AccountRow[] {
  return accounts
    .filter((a) => e.parts.includes(a.part))
    .map((a) => {
      const shared = accounts
        .filter(
          (o) =>
            o.part !== a.part && o.part !== "pi" && e.parts.includes(o.part),
        )
        .flatMap((o) => o.keys);
      const keys =
        a.part === "pi" ? a.keys.filter((k) => !shared.includes(k)) : a.keys;
      const setKeys = keys.filter((k) => isSet(e, k));
      return { ...a, keys, set: setKeys.length > 0, setKeys };
    });
}

export function secretSet(e: EnvInfo, name: string): boolean {
  return isSet(e, name);
}

export function extraSecrets(e: EnvInfo): EnvSecret[] {
  return e.secrets.filter((s) => !managed.has(s.name));
}
