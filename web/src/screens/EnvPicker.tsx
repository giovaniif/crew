import { useEffect, useRef, useState, type ReactNode } from "react";
import { environmentList, type Authed, type Mate, type MachineEnvironments } from "../api";
import { envGroups, envLine, envName, identityId, isYours, machineChoices, machineLabel, missingKey, type EnvGroup } from "../envmenu";
import { useHub, type HubState } from "../hub";
import { useMachine } from "./Machine";
import { Menu, type MenuEntry } from "../ui";

export type EnvPick = { key: string; machineId: string; id: string };

export function EIcon({ id, px = 18 }: { id: string; px?: number }) {
  const yours = isYours(id);
  return (
    <span className={"eicon " + (yours ? "y" : "c")} style={{ width: px, height: px, fontSize: px > 20 ? 10 : 9 }} aria-hidden="true">
      {yours ? "Y" : id.charAt(0).toUpperCase()}
    </span>
  );
}

function useAway(open: boolean, close: () => void) {
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const away = (e: MouseEvent) => {
      if (!anchor.current?.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open, close]);
  return anchor;
}

function groupEntries(group: EnvGroup, checked: string | undefined): MenuEntry[] {
  return [
    { kind: "label" as const, label: group.label },
    ...group.items.map((c) => ({
      value: JSON.stringify([group.key, group.machineId, c.id]),
      label: c.label,
      icon: <EIcon id={c.id} />,
      hint: <span aria-hidden="true">{c.hint}</span>,
      checked: checked === group.key + "\n" + c.id,
      disabled: !group.up,
    })),
  ];
}

export function useMachineEnvironments(api: Authed): { list: MachineEnvironments | null; down: boolean } {
  const [state, setState] = useState<{ list: MachineEnvironments | null; down: boolean }>({ list: null, down: false });
  useEffect(() => {
    let live = true;
    environmentList(api)
      .then((list) => live && setState({ list, down: false }))
      .catch(() => live && setState({ list: null, down: true }));
    return () => {
      live = false;
    };
  }, [api]);
  return state;
}

export function EnvRail({ api, mate, extra, onPick }: { api: Authed; mate: Mate; extra?: { value: string; label: string; run: () => void }[]; onPick: (machineId: string, id: string) => void }) {
  const { hub } = useHub(api);
  const { list, down } = useMachineEnvironments(api);
  const fallback = useMachine();
  const [open, setOpen] = useState(false);
  const anchor = useAway(open, () => setOpen(false));
  const name = list?.machine.name ?? fallback;
  const here = list ? hub?.machines.find((m) => m.machine?.id === list.machine.id) : undefined;
  const local = !!here?.local;
  const envHref = (identity: string) => "#/envs/" + encodeURIComponent(here?.key ?? "this") + "/" + encodeURIComponent(identity);
  const label = machineLabel(name, local);
  const id = identityId(mate.env);
  const title = envName(label, id);
  const line = down ? "Runs on " + name + "." : envLine(name, local, id, list?.found);
  const identity = list?.identities?.find((i) => identityId(i.name) === id);
  const missing = missingKey(identity, mate.agent);
  const group: EnvGroup = { key: "rail", machineId: list?.machine.id ?? "", label, up: !!list, items: machineChoices(list?.identities ?? []) };
  const items: MenuEntry[] = [
    ...groupEntries(group, "rail\n" + id).map((e) => ("icon" in e ? { ...e, icon: undefined } : e)),
    { kind: "sep" as const },
    { value: "+new", label: "+ Separate identity on " + label + "…" },
    ...(extra ?? []).map((x) => ({ value: x.value, label: x.label })),
  ];
  return (
    <div className="kv env-kv">
      <h4>ENVIRONMENT</h4>
      <div className="muted env-note">{"Where " + mate.name + " runs, and whose accounts it uses."}</div>
      <span ref={anchor} className="ui-anchor">
        <button type="button" className="ui select env-pick" aria-label={"Environment: " + title} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="env-pick-in">
            <EIcon id={id} px={22} />
            <span>
              <span className="env-pick-t">{title}</span>
              <span className="muted env-pick-s">{line}</span>
            </span>
          </span>
          <span className="chev" aria-hidden="true">
            ▾
          </span>
        </button>
        {open && (
          <Menu
            label="Environment"
            className="env-pick-menu"
            items={items}
            onPick={(v) => {
              setOpen(false);
              if (v === "+new") {
                window.location.hash = "#/envs";
                return;
              }
              const run = extra?.find((x) => x.value === v);
              if (run) {
                run.run();
                return;
              }
              const [, machineId, pick] = JSON.parse(v) as string[];
              onPick(machineId, pick);
            }}
            onClose={() => setOpen(false)}
          />
        )}
      </span>
      {missing && (
        <div className="warnrow">
          <span className="dot wait" aria-hidden="true" />
          <span>
            {id + " has no " + missing + " key, and " + mate.name + " uses " + missing + ". "}
            <a href={envHref(id)}>Set key</a>
          </span>
        </div>
      )}
      {down && (
        <div className="warnrow bad">
          <span className="dot bad" aria-hidden="true" />
          <span>
            {name + " is not reachable. " + mate.name + " cannot start a conversation. "}
            <a href="#/envs">Check connection</a>
          </span>
        </div>
      )}
      <a className="env-open" href={envHref(id)}>
        Open environment
      </a>
    </div>
  );
}

export function defaultPick(state: HubState): EnvPick | null {
  const group = state.hub ? envGroups(state.hub).find((g) => g.up) : undefined;
  return group ? { key: group.key, machineId: group.machineId, id: "yours" } : null;
}

export function EnvChip({ state, value, onChange }: { state: HubState; value: EnvPick | null; onChange: (pick: EnvPick) => void }) {
  const [open, setOpen] = useState(false);
  const anchor = useAway(open, () => setOpen(false));
  const groups = state.hub ? envGroups(state.hub) : [];
  const group = groups.find((g) => g.key === value?.key);
  const title: ReactNode = value && group ? envName(group.label, value.id) : "…";
  return (
    <span ref={anchor} className="ui-anchor">
      <button
        type="button"
        className={"chip env-chip" + (open ? " on" : "")}
        aria-label={"Environment: " + (typeof title === "string" ? title : "")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {title}{" "}
        <span className="chev" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <Menu
          label="Environment"
          search="Search environments"
          className="env-menu"
          items={[
            ...groups.flatMap((g) => groupEntries(g, value ? value.key + "\n" + value.id : undefined)),
            { kind: "sep" as const },
            { value: "+identity", label: "+ Separate identity…" },
            { value: "+server", label: "+ Connect a server…" },
          ]}
          onPick={(v) => {
            setOpen(false);
            if (v.startsWith("+")) {
              window.location.hash = "#/envs";
              return;
            }
            const [key, machineId, id] = JSON.parse(v) as string[];
            onChange({ key, machineId, id });
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </span>
  );
}
