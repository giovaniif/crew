import type { KeyValue } from "./auth";
import { adoptLegacy, legacyChoicesKey } from "./legacy";

export type Choices = {
  workspace: string;
  harness: string;
  model: string;
  effort: string;
};

const key = "crew.new";

export const harnesses = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
];

export const modelChoices: Record<string, string[]> = {
  claude: ["opus", "sonnet", "haiku"],
  codex: ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.5"],
};

export const effortChoices = ["low", "medium", "high", "xhigh", "max"];

export function defaultLabel(value: string | undefined): string {
  const name = (value ?? "").trim();
  return name ? "default (" + name + ")" : "default";
}

export function loadChoices(storage: KeyValue): Choices {
  const fallback: Choices = { workspace: "", harness: "claude", model: "", effort: "" };
  try {
    const raw = adoptLegacy(storage, key, legacyChoicesKey);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<Choices>;
    const text = (v: unknown) => (typeof v === "string" ? v : "");
    return {
      workspace: text(parsed.workspace),
      harness: harnesses.some((h) => h.id === parsed.harness) ? (parsed.harness as string) : fallback.harness,
      model: text(parsed.model),
      effort: effortChoices.includes(text(parsed.effort)) ? text(parsed.effort) : "",
    };
  } catch {
    return fallback;
  }
}

export function saveChoices(storage: KeyValue, choices: Choices): void {
  try {
    storage.setItem(key, JSON.stringify(choices));
  } catch {
    return;
  }
}

export function agentValue(harness: string, model: string): string {
  return harness + "|" + model;
}

export function splitAgent(value: string): { harness: string; model: string } {
  const at = value.indexOf("|");
  return at < 0 ? { harness: value, model: "" } : { harness: value.slice(0, at), model: value.slice(at + 1) };
}

export function agentChoices(defaults: Record<string, string>, extra: { harness: string; model: string } | null): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (const h of harnesses) {
    out.push({ value: agentValue(h.id, ""), label: h.label + " · " + defaultLabel(defaults[h.id]) });
    const models = modelChoices[h.id] ?? [];
    for (const m of models) {
      out.push({ value: agentValue(h.id, m), label: h.label + " · " + m });
    }
    if (extra && extra.harness === h.id && extra.model && !models.includes(extra.model)) {
      out.push({ value: agentValue(h.id, extra.model), label: h.label + " · " + extra.model });
    }
  }
  return out;
}

export function taskFields(text: string): { work_item: string; prompt: string } {
  const trimmed = text.trim();
  if (/^https?:\/\/\S+$/.test(trimmed)) {
    return { work_item: trimmed, prompt: "" };
  }
  const first = trimmed.split("\n")[0]?.trim() ?? "";
  return { work_item: first, prompt: trimmed.includes("\n") ? trimmed : "" };
}
