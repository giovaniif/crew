import { useCallback, useEffect, useState } from "react";
import { fixHooks, getHooks, type Authed, type HooksMissing } from "../api";
import { Button } from "../ui";

const harnessTitles: Record<string, string> = { claude: "Claude", codex: "Codex", omp: "Pi" };

function title(h: string): string {
  return harnessTitles[h] ?? h;
}

export function HooksBanner({
  api,
  missing,
  onFixed,
}: {
  api: Authed;
  missing?: HooksMissing[];
  onFixed: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  if (!missing || missing.length === 0) {
    return null;
  }
  const fix = (m: HooksMissing) => {
    setBusy(m.harness);
    setError("");
    fixHooks(api, m.env, m.harness)
      .then(onFixed)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(""));
  };
  return (
    <>
      {missing.map((m) => (
        <div key={m.env + "/" + m.harness} className="notice" role="alert" aria-label={title(m.harness) + " hooks"}>
          <span className="dot wait" />
          <span>
            {m.new
              ? m.reason + ". Without them, crew can not see what " + title(m.harness) + " does."
              : m.reason + ". Sessions do not show running or waiting until you fix it."}
          </span>
          <span className="spacer" />
          <Button variant="primary" className="sm" disabled={busy === m.harness} onClick={() => fix(m)}>
            {m.new ? "Set up" : "Fix"}
          </Button>
        </div>
      ))}
      {error ? (
        <p className="error" role="status">
          {error}
        </p>
      ) : null}
    </>
  );
}

export function LocalHooksBanner({ api }: { api: Authed }) {
  const [missing, setMissing] = useState<HooksMissing[]>([]);
  const load = useCallback(() => {
    getHooks(api).then(
      (h) => setMissing((h.missing ?? []).filter((m) => m.env === "local")),
      () => setMissing([]),
    );
  }, [api]);
  useEffect(load, [load]);
  return <HooksBanner api={api} missing={missing} onFixed={load} />;
}
