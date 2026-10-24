import { useEffect, useState } from "react";
import { mateExport, mateImport, type Authed } from "../api";
import { envGroups, envName } from "../envmenu";
import { authedOf, useHub } from "../hub";
import { Button, Dialog, Select } from "../ui";
import { useMachineEnvironments } from "./EnvPicker";

export function copyName(name: string, taken: string[]): string {
  if (!taken.includes(name)) {
    return name;
  }
  let n = 2;
  while (taken.includes(name + "-" + n)) {
    n++;
  }
  return name + "-" + n;
}

export function CopyMate({ api, name, onClose }: { api: Authed; name: string; onClose: () => void }) {
  const state = useHub(api);
  const { list } = useMachineEnvironments(api);
  const source = list?.machine;
  const groups = state.hub ? envGroups(state.hub) : [];
  const targets = groups.filter((g) => g.up && g.machineId !== source?.id);
  const sourceLabel = groups.find((g) => g.up && g.machineId === source?.id)?.label;
  const [key, setKey] = useState("");
  const [id, setId] = useState("yours");
  const [copy, setCopy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [done, setDone] = useState("");
  const target = targets.find((g) => g.key === key) ?? targets[0];
  const taken = state.hub && target ? state.hub.mates.filter((m) => m.key === target.key).map((m) => m.item.name) : [];
  const suggested = copyName(name, taken);
  useEffect(() => setCopy(null), [target?.key]);
  const value = copy ?? suggested;

  async function run() {
    const link = state.links.find((l) => l.key === target?.key);
    if (!link || !target) {
      return;
    }
    setBusy(true);
    setNote("");
    try {
      const exported = await mateExport(api, name);
      const out = await mateImport(authedOf(link), { ...exported, mate: { ...exported.mate, name: value } }, { machine_id: target.machineId, identity_id: id });
      setDone("Copied as " + out.name + " on " + target.label + ".");
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={"Copy " + name + " to another machine"} onClose={onClose} className="copy-mate">
      <p>{"crew makes a new mate on the target machine with the same role, memory and look. " + name + " stays on " + (sourceLabel ?? "its machine") + " and keeps its threads."}</p>
      {done ? (
        <p role="status">{done}</p>
      ) : targets.length === 0 ? (
        <p className="muted">{state.hub ? "No other machine is connected. Connect a server on the Environments page." : "Loading…"}</p>
      ) : (
        <>
          <div className="fld">
            <label>Target machine</label>
            <Select
              label="Target machine"
              value={target!.key}
              options={targets.map((g) => ({ value: g.key, label: g.label }))}
              onChange={(v) => {
                setKey(v);
                setId("yours");
              }}
            />
          </div>
          <div className="fld">
            <label>{"Environment on " + target!.label}</label>
            <Select label={"Environment on " + target!.label} value={id} options={target!.items.map((c) => ({ value: c.id, label: envName(target!.label, c.id) }))} onChange={setId} />
          </div>
          <div className="fld">
            <label htmlFor="copy-mate-name">Name</label>
            <input id="copy-mate-name" className="ui input" value={value} onChange={(e) => setCopy(e.target.value)} />
            {suggested !== name && <span className="muted fld-note">{name + " is taken on " + target!.label + "."}</span>}
          </div>
        </>
      )}
      {note && (
        <p className="error" role="alert">
          {note}
        </p>
      )}
      <div className="dialog-actions">
        {done ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="quiet" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={busy || !target || value.trim() === ""} onClick={() => void run()}>
              {"Copy " + name}
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}
