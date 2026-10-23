import type { EnvInfo, EnvSecret } from "./api";

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
  return e.kind === "local" && e.name === "local";
}

export function envOrder(envs: EnvInfo[]): EnvInfo[] {
  return [...envs.filter(isLocal), ...envs.filter((e) => !isLocal(e))];
}

export function envTitle(e: EnvInfo): string {
  return isLocal(e) ? "Local (this Mac)" : e.name;
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
