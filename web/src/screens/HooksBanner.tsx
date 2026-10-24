import { useState } from "react";
import { fixHooks, type Authed, type HooksMissing } from "../api";
import { Button } from "../ui";

const harnessTitles: Record<string, string> = { claude: "Claude", codex: "Codex", omp: "Pi" };

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
        <div
          key={m.env + "/" + m.harness}
          className="notice"
          role="alert"
          aria-label={(harnessTitles[m.harness] ?? m.harness) + " hooks"}
        >
          <span className="dot wait" />
          <span>
            {m.reason}. Sessions do not show running or waiting until you fix it.
          </span>
          <span className="spacer" />
          <Button variant="primary" className="sm" disabled={busy === m.harness} onClick={() => fix(m)}>
            Fix
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
