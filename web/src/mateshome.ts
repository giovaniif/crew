import type { Approval } from "./api";
import type { MateCard } from "./faces";
import type { MateRow } from "./stream";

export type Harness = "all" | "claude" | "codex" | "pi";

export type PillTone = "warn" | "blue" | "";

export type HomeCard = { card: MateCard; approval: Approval | null; pill: string; tone: PillTone; last: string; when: string; open: string };

export type Activity = { name: string; text: string; when: string; href: string };

export function agoLabel(at: string, now: number): string {
  const start = Date.parse(at);
  if (Number.isNaN(start)) {
    return "";
  }
  const minutes = Math.max(0, Math.floor((now - start) / 60000));
  if (minutes < 1) {
    return "now";
  }
  if (minutes < 60) {
    return minutes + "m ago";
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return hours + "h ago";
  }
  return hours < 48 ? "yesterday" : Math.floor(hours / 24) + "d ago";
}

function live(row: MateRow) {
  return [
    ...row.threads.filter((t) => !t.ended).map((t) => ({ session: t.session_id, state: t.state, started_at: "" })),
    ...(row.conversations ?? []).filter((c) => !c.ended),
  ];
}

function latest(row: MateRow): string {
  return (row.conversations ?? []).map((c) => c.started_at).reduce((a, b) => (Date.parse(b) > Date.parse(a || "0") ? b : a), "");
}

const pills: Record<string, [string, PillTone]> = {
  needs: ["needs you", "warn"],
  working: ["working", "blue"],
  thinking: ["working", "blue"],
  paused: ["paused", ""],
  idle: ["idle", ""],
};

function homeCard(card: MateCard, approvals: Approval[], now: number): HomeCard {
  const approval = approvals.find((a) => a.Mate === card.name && a.State === "pending") ?? null;
  const [pill, tone] = pills[card.face] ?? ["idle", ""];
  const waiting = live(card.row).find((c) => c.state === "waiting" || c.state === "permission");
  const session = approval?.SessionID || waiting?.session || "";
  const last = approval ? "Asks: " + (approval.Action.Input.split("\n")[0] || approval.Action.Tool) : card.status;
  return { card, approval, pill, tone, last, when: agoLabel(approval?.At || latest(card.row), now), open: session ? "#/sessions/" + encodeURIComponent(session) : "" };
}

export function homeCards(cards: MateCard[], approvals: Approval[], harness: Harness, now: number): HomeCard[] {
  const shown = cards.filter((c) => harness === "all" || c.agent === harness).map((c) => homeCard(c, approvals, now));
  return [...shown.filter((c) => c.card.face === "needs"), ...shown.filter((c) => c.card.face !== "needs")];
}

export function homeSummary(cards: MateCard[]): string {
  const working = cards.filter((c) => c.face === "working" || c.face === "thinking").length;
  return cards.length + (cards.length === 1 ? " mate" : " mates") + " · " + working + " working";
}

export function recentActivity(rows: MateRow[], now: number): Activity[] {
  return rows
    .flatMap((r) => (r.conversations ?? []).map((c) => ({ r, c, t: Date.parse(c.started_at) })))
    .filter((x) => !Number.isNaN(x.t))
    .sort((a, b) => b.t - a.t)
    .slice(0, 3)
    .map(({ r, c }) => ({ name: r.name, text: "started “" + c.name + "”", when: agoLabel(c.started_at, now), href: "#/sessions/" + encodeURIComponent(c.session) }));
}
