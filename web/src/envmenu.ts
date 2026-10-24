import type { EnvInfo, EnvLocal } from "./api";
import { piKeys } from "./envs";
import type { Hub } from "./machines";

export type EnvChoice = { id: string; label: string; hint: string; yours: boolean };

export type EnvGroup = { key: string; machineId: string; label: string; up: boolean; items: EnvChoice[] };

export const thisMac = "This Mac";

export function isYours(id: string | undefined): boolean {
  return !id || id === "yours" || id === "local";
}

export function identityId(id: string | undefined): string {
  return isYours(id) ? "yours" : (id as string);
}

export function machineLabel(name: string, local: boolean): string {
  return local ? thisMac : name;
}

export function envName(machine: string, id: string | undefined): string {
  return machine + " · " + (isYours(id) ? "your accounts" : (id as string));
}

export function envLine(machine: string, local: boolean, id: string | undefined, found?: EnvLocal): string {
  const where = local ? "Runs on this Mac." : "Runs on " + machine + ".";
  let who = "Commits as " + id + ".";
  if (isYours(id)) {
    const known = local || !found ? [] : [found.git_name, found.github_user ? "@" + found.github_user : ""].filter(Boolean);
    who = known.length > 0 ? "Acts as you (" + known.join(", ") + ")." : "Acts as you.";
  }
  return [where, who, local ? "Stops when the Mac sleeps." : ""].filter(Boolean).join(" ");
}

function choice(e: EnvInfo): EnvChoice {
  return isYours(e.name) ? { id: "yours", label: "Your accounts", hint: "as you", yours: true } : { id: e.name, label: e.name, hint: "identity", yours: false };
}

export function machineChoices(identities: EnvInfo[]): EnvChoice[] {
  const all = identities.map(choice);
  const yours = all.filter((c) => c.yours).slice(0, 1);
  return [...(yours.length > 0 ? yours : [choice({ name: "yours", kind: "local", parts: [], secrets: [], used_by: [] })]), ...all.filter((c) => !c.yours)];
}

export function envGroups(hub: Hub): EnvGroup[] {
  return hub.machines.map((m) => {
    const label = machineLabel(m.name, m.local);
    if (m.state === "down" || !m.machine) {
      return { key: m.key, machineId: "", label: label + " · not reachable", up: false, items: [{ id: "yours", label: "Your accounts", hint: "offline", yours: true }] };
    }
    const identities = hub.environments.filter((e) => e.key === m.key).map((e) => e.item);
    return { key: m.key, machineId: m.machine.id, label, up: true, items: machineChoices(identities) };
  });
}

const harnessKeys: Record<string, { part: string; title: string; keys: string[]; login?: "codex_login" | "pi_login" }> = {
  claude: { part: "claude", title: "Claude", keys: ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"] },
  codex: { part: "codex", title: "Codex", keys: ["OPENAI_API_KEY"], login: "codex_login" },
  omp: { part: "pi", title: "Pi", keys: piKeys, login: "pi_login" },
};

export function missingKey(e: EnvInfo | undefined, agent: string): string {
  const h = harnessKeys[agent];
  if (!e || !h || isYours(e.name) || e.kind !== "custom" || !e.parts.includes(h.part)) {
    return "";
  }
  if (h.login && e[h.login]) {
    return "";
  }
  return (e.secrets ?? []).some((s) => s.set && h.keys.includes(s.name)) ? "" : h.title;
}
