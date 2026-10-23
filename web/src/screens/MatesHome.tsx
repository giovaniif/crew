import { useCallback, useEffect, useState } from "react";
import { type Approval, type Authed, decideApproval, listApprovals } from "../api";
import { mateCard } from "../faces";
import { envBadge, type Harness, type HomeCard, homeCards, homeSummary, recentActivity } from "../mateshome";
import type { Mates as MateBoard } from "../stream";
import { Button, Segmented, Select } from "../ui";
import { useEnvs } from "./Environments";
import { MateFace, useMateDefs } from "./Mates";
import type { EnvInfo } from "../api";

const harnesses: { value: Harness; label: string }[] = [
  { value: "all", label: "All" },
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
  { value: "omp", label: "Pi" },
];

function envOptions(envs: EnvInfo[]): { value: string; label: string }[] {
  const named = envs.filter((e) => e.name !== "local").map((e) => ({ value: e.name, label: e.name }));
  return [{ value: "any", label: "Any environment" }, { value: "local", label: "Local" }, ...named];
}

const harnessNames: Record<string, string> = { claude: "Claude", codex: "Codex", omp: "Pi" };

function useApprovals(api: Authed): [Approval[], () => void] {
  const [list, setList] = useState<Approval[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let on = true;
    listApprovals(api)
      .then((out) => on && setList(out))
      .catch(() => undefined);
    return () => {
      on = false;
    };
  }, [api, tick]);
  return [list, useCallback(() => setTick((n) => n + 1), [])];
}

function Face({ c, px }: { c: HomeCard; px: number }) {
  const { row, def } = c.card;
  return <MateFace name={row.name} avatar={row.avatar || def?.avatar} color={row.color || def?.color} state={c.card.face} px={px} />;
}

function Tags({ c, envs }: { c: HomeCard; envs: EnvInfo[] }) {
  const badge = envBadge(c.card.def?.env, envs);
  return (
    <>
      {c.card.agent ? <span className="hz">{harnessNames[c.card.agent] ?? c.card.agent}</span> : null}
      <span className={"envb " + badge.kind}>{badge.label}</span>
    </>
  );
}

function Decide({ api, approval, onDone }: { api: Authed; approval: Approval; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const decide = (approve: boolean) => {
    setBusy(true);
    decideApproval(api, approval.ID, approve)
      .catch(() => undefined)
      .finally(() => {
        setBusy(false);
        onDone();
      });
  };
  return (
    <div className="mcard-act">
      <Button className="sm" disabled={busy} onClick={() => decide(false)}>
        Deny
      </Button>
      <Button className="sm" variant="primary" disabled={busy} onClick={() => decide(true)}>
        Approve
      </Button>
    </div>
  );
}

function Card({ api, c, envs, onDone }: { api: Authed; c: HomeCard; envs: EnvInfo[]; onDone: () => void }) {
  const href = "#/mates/" + encodeURIComponent(c.card.name);
  return (
    <article className={"mcard" + (c.card.face === "needs" ? " need" : "")} aria-labelledby={"mcard-" + c.card.name}>
      <div className="top">
        <Face c={c} px={32} />
        <div className="who">
          <h2 className="nm" id={"mcard-" + c.card.name}>
            <a href={href}>{c.card.name}</a>
          </h2>
          <div className="role">{c.card.tagline}</div>
        </div>
        <span className={"pill" + (c.tone ? " " + c.tone : "")}>{c.pill}</span>
      </div>
      <div className="last">{c.last}</div>
      {c.approval ? <Decide api={api} approval={c.approval} onDone={onDone} /> : null}
      <div className="foot">
        <Tags c={c} envs={envs} />
        <span className="spacer" />
        <span>{c.when}</span>
      </div>
    </article>
  );
}

type Props = { api: Authed; now: number; board?: MateBoard; wide: boolean };

export function MatesHome({ api, now, board, wide }: Props) {
  const { defs } = useMateDefs(api);
  const [approvals, reload] = useApprovals(api);
  const [harness, setHarness] = useState<Harness>("all");
  const [env, setEnv] = useState("any");
  const { envs } = useEnvs(api);
  const rows = board?.mates ?? [];
  const asking = approvals.filter((a) => a.State === "pending").map((a) => a.Mate);
  const cards = rows.map((row) => mateCard(row, defs.find((d) => d.name === row.name), asking));
  const shown = homeCards(cards, approvals, harness, now, env);
  const need = shown.find((c) => c.card.face === "needs");
  const empty = board === undefined ? "Loading…" : rows.length === 0 ? "No mates yet." : shown.length === 0 ? "No mate matches." : "";

  if (!wide) {
    return (
      <main className="screen mh-phone">
        <div className="ptop">
          <h1>Mates</h1>
          <span className="spacer" />
          <a className="ui icon-btn" href="#/mates/new" aria-label="New mate">
            +
          </a>
        </div>
        <div className="pbody">
          {need ? (
            <a className="needbar" href={need.open || "#/mates/" + encodeURIComponent(need.card.name)}>
              <span className="dot wait" aria-hidden="true" />
              <span>
                <b>{need.card.name}</b> waits for you
              </span>
              <span className="spacer" />
              <span className="muted" aria-hidden="true">
                ›
              </span>
            </a>
          ) : null}
          {empty ? <p className="mt-note">{empty}</p> : null}
          <ul className="mrows" aria-label="Mates">
            {shown.map((c) => (
              <li key={c.card.name}>
                <a className="mrow" href={"#/mates/" + encodeURIComponent(c.card.name)}>
                  <Face c={c} px={40} />
                  <span className="g">
                    <span className="t">
                      {c.card.name}
                      <span className={"dot" + (c.tone === "warn" ? " wait" : c.tone === "blue" ? " run" : "")} aria-hidden="true" />
                    </span>
                    <span className="s">{c.last}</span>
                    <span className="tags">
                      <Tags c={c} envs={envs} />
                    </span>
                  </span>
                  <span className="when">{c.when}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </main>
    );
  }

  const recent = recentActivity(rows, now);
  return (
    <div className="mh">
      <div className="mh-bar">
        <h1 className="title">Mates</h1>
        <span className="sub">{homeSummary(cards)}</span>
        <span className="spacer" />
        <Segmented label="Harness" value={harness} options={harnesses} onChange={setHarness} />
        <Select label="Environment" value={env} options={envOptions(envs)} onChange={setEnv} className="mh-env" />
      </div>
      <div className="mh-page">
        {need ? (
          <div className="needbar" role="status" aria-label="Needs you">
            <span className="dot wait" aria-hidden="true" />
            <span>
              <b>{need.card.name}</b> waits for your answer.
            </span>
            <span className="spacer" />
            {need.open ? (
              <a className="ui btn quiet sm" href={need.open}>
                Open thread
              </a>
            ) : null}
          </div>
        ) : null}
        {empty && board === undefined ? <p className="mt-note">{empty}</p> : null}
        <div className="mgrid">
          {shown.map((c) => (
            <Card key={c.card.name} api={api} c={c} envs={envs} onDone={reload} />
          ))}
          <a className="mcard mcard-new" href="#/mates/new">
            + New mate
          </a>
        </div>
        {recent.length > 0 ? (
          <>
            <div className="section-title" aria-hidden="true">
              RECENT ACTIVITY
            </div>
            <ul className="mh-list" aria-label="Recent activity">
              {recent.map((r) => {
                const row = rows.find((x) => x.name === r.name);
                const def = defs.find((d) => d.name === r.name);
                return (
                  <li key={r.href + r.text}>
                    <a className="li" href={r.href}>
                      <MateFace name={r.name} avatar={row?.avatar || def?.avatar} color={row?.color || def?.color} state="idle" px={20} />
                      <span className="grow">
                        <span className="t">{r.name}</span> <span className="dim">{r.text}</span>
                      </span>
                      <span className="when">{r.when}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}
