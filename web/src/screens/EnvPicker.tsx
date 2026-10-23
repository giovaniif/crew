import { useEffect, useRef, useState } from "react";
import type { EnvInfo } from "../api";
import { envLetter, envTitle, usedLabel } from "../envs";
import { mateEnvName } from "../mateshome";
import { Menu, Select } from "../ui";

const localInfo: EnvInfo = {
  name: "local",
  kind: "local",
  parts: [],
  secrets: [],
  used_by: [],
};

function withLocal(envs: EnvInfo[]): EnvInfo[] {
  return envs.some((e) => e.name === "local") ? envs : [localInfo, ...envs];
}

function EIcon({ env }: { env: EnvInfo }) {
  return (
    <span
      className={"eicon sm" + (env.kind === "custom" ? " c" : "")}
      aria-hidden="true"
    >
      {envLetter(env)}
    </span>
  );
}

export function envValue(name: string): string | undefined {
  return mateEnvName(name) === "local" ? undefined : name;
}

export function EnvRail({
  envs,
  value,
  onChange,
}: {
  envs: EnvInfo[];
  value: string | undefined;
  onChange: (env: string | undefined) => void;
}) {
  const list = withLocal(envs);
  const name = mateEnvName(value);
  const current = list.find((e) => e.name === name) ?? {
    ...localInfo,
    name,
    kind: "custom" as const,
  };
  return (
    <div className="kv env-kv">
      <h4>ENVIRONMENT</h4>
      <Select
        label="Environment"
        value={name}
        className="env-select"
        options={list.map((e) => ({
          value: e.name,
          label: envTitle(e),
          hint: <EIcon env={e} />,
        }))}
        onChange={(v) => onChange(envValue(v))}
      />
      <div className="muted env-note">
        {current.kind === "local"
          ? "Uses your git, SSH, gh and Claude logins."
          : "Isolated: its own git identity, keys and accounts."}{" "}
        <a href={"#/envs/" + encodeURIComponent(name)}>Edit environment</a>
      </div>
      <div className="muted env-note">
        Changes apply when the next conversation starts.
      </div>
    </div>
  );
}

export function EnvChip({
  envs,
  value,
  onChange,
}: {
  envs: EnvInfo[];
  value: string | undefined;
  onChange: (env: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const list = withLocal(envs);
  const name = mateEnvName(value);
  const current = list.find((e) => e.name === name);
  const title = current ? envTitle(current) : name;
  useEffect(() => {
    if (!open) {
      return;
    }
    const away = (e: MouseEvent) => {
      if (!anchor.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  return (
    <span ref={anchor} className="ui-anchor">
      <button
        type="button"
        className={"chip env-chip" + (open ? " on" : "")}
        aria-label={"Environment: " + title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Env: {title}{" "}
        <span className="chev" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <Menu
          label="Environment"
          search="Search environments"
          items={[
            { kind: "label" as const, label: "Environments" },
            ...list.map((e) => ({
              value: e.name,
              label: envTitle(e),
              checked: e.name === name,
              hint: (
                <span aria-hidden="true">
                  {e.kind === "local"
                    ? "your logins"
                    : usedLabel(e.used_by.length)}
                </span>
              ),
            })),
            { kind: "sep" as const },
            { value: "+new", label: "+ New environment…" },
          ]}
          onPick={(v) => {
            setOpen(false);
            if (v === "+new") {
              window.location.hash = "#/envs";
              return;
            }
            onChange(envValue(v));
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </span>
  );
}
