type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

type DesktopWindow = {
  __CREW_DESKTOP_PROBLEM__?: unknown;
  __TAURI_INTERNALS__?: { invoke?: Invoke };
};

export function desktopProblem(w: object): string | null {
  const problem = (w as DesktopWindow).__CREW_DESKTOP_PROBLEM__;
  return typeof problem === "string" && problem.trim() !== "" ? problem : null;
}

export function desktopFix(w: object): (() => Promise<void>) | undefined {
  const invoke = (w as DesktopWindow).__TAURI_INTERNALS__?.invoke;
  if (typeof invoke !== "function") {
    return undefined;
  }
  return async () => {
    try {
      await invoke("fix_daemon");
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err));
    }
  };
}
