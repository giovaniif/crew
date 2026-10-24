import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { addWorkspace, claudeTrust, trustClaude, expandPath, listWorkspaces, removeWorkspace, resolveWorkItem, sessionOptions, startSession, type HarnessOptions, type WorkItemResolved, type WorkspaceList } from "../api";
import type { AppEnv } from "../App";
import { agentChoices, agentValue, defaultLabel, effortChoices, loadChoices, placeLine, rememberedRoot, saveChoices, splitAgent, taskFields } from "../newsession";
import { Button, Select } from "../ui";
import { LocalHooksBanner } from "./HooksBanner";

type Resolution = { state: "idle" } | { state: "checking" } | { state: "ok"; item: WorkItemResolved } | { state: "bad"; message: string };

type Workspaces = { state: "loading" } | { state: "ready"; list: WorkspaceList } | { state: "failed"; message: string };

const checkDelay = 350;

function baseName(root: string): string {
  const parts = root.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? root;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function NewSession({ env, token, home: atHome }: { env: AppEnv; token: string; home?: boolean }) {
  const [remembered] = useState(() => loadChoices(env.storage));
  const api = useMemo(() => ({ fetch: env.fetch, token }), [env.fetch, token]);
  const [workspaces, setWorkspaces] = useState<Workspaces>({ state: "loading" });
  const [workspace, setWorkspace] = useState(remembered.workspace);
  const [text, setText] = useState("");
  const [harness, setHarness] = useState(remembered.harness);
  const [model, setModel] = useState(remembered.model);
  const [effort, setEffort] = useState(remembered.effort);
  const [resolution, setResolution] = useState<Resolution>({ state: "idle" });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [defaults, setDefaults] = useState<HarnessOptions[]>([]);
  const [home, setHome] = useState("");
  const [adding, setAdding] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [addError, setAddError] = useState("");
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const [select, setSelect] = useState("");
  const [untrusted, setUntrusted] = useState("");
  const [trustError, setTrustError] = useState("");

  useEffect(() => {
    setUntrusted("");
    setTrustError("");
    if (harness !== "claude" || !workspace) {
      return;
    }
    let live = true;
    claudeTrust({ fetch: env.fetch, token }, workspace).then(
      (t) => live && !t.trusted && setUntrusted(workspace),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [env.fetch, token, harness, workspace]);

  function trust() {
    setTrustError("");
    trustClaude({ fetch: env.fetch, token }, untrusted).then(
      (t) => t.trusted && setUntrusted(""),
      (err: unknown) => setTrustError(message(err)),
    );
  }

  useEffect(() => {
    let live = true;
    sessionOptions(env.fetch, token).then(
      (options) => {
        if (live) {
          setDefaults(options.harnesses ?? []);
          setHome(options.home ?? "");
        }
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [env.fetch, token]);

  async function submitWorkspace(e: FormEvent) {
    e.preventDefault();
    setAddError("");
    try {
      const added = await addWorkspace(env.fetch, token, expandPath(newPath, home));
      setSelect(added.Root);
      setAdding(false);
      setNewPath("");
      setAttempt((n) => n + 1);
    } catch (err) {
      setAddError(message(err));
    }
  }

  async function confirmRemove() {
    setRemoveError("");
    try {
      await removeWorkspace(env.fetch, token, workspace);
      setRemoving(false);
      setSelect("");
      setWorkspace("");
      setAttempt((n) => n + 1);
    } catch (err) {
      setRemoveError(message(err));
    }
  }

  useEffect(() => {
    let live = true;
    listWorkspaces(env.fetch, token).then(
      (list) => {
        if (!live) {
          return;
        }
        setWorkspaces({ state: "ready", list });
        setWorkspace((current) => {
          const has = (root: string) => list.workspaces.some((w) => w.Root === root);
          if (select && has(select)) {
            return select;
          }
          return rememberedRoot(current, list.workspaces.map((w) => w.Root)) || list.last_used || list.workspaces[0]?.Root || "";
        });
      },
      (err) => live && setWorkspaces({ state: "failed", message: message(err) }),
    );
    return () => {
      live = false;
    };
  }, [env.fetch, token, attempt]);

  const fields = taskFields(text);
  const item = fields.work_item;

  useEffect(() => {
    if (!item || !workspace) {
      setResolution({ state: "idle" });
      return;
    }
    let live = true;
    setResolution({ state: "checking" });
    const timer = setTimeout(() => {
      resolveWorkItem(env.fetch, token, workspace, item).then(
        (resolved) => live && setResolution({ state: "ok", item: resolved }),
        (err) => live && setResolution({ state: "bad", message: message(err) }),
      );
    }, checkDelay);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [env.fetch, token, workspace, item]);

  function chooseAgent(value: string) {
    const next = splitAgent(value);
    setHarness(next.harness);
    setModel(next.model);
  }

  async function submit(event: FormEvent | KeyboardEvent) {
    event.preventDefault();
    if (!canStart) {
      return;
    }
    setBusy(true);
    setFailure("");
    try {
      const body = {
        workspace,
        work_item: item,
        harness,
        ...(model.trim() ? { model: model.trim() } : {}),
        ...(effort ? { effort } : {}),
        ...(fields.prompt ? { prompt: fields.prompt } : {}),
      };
      const session = await startSession(env.fetch, token, body);
      saveChoices(env.storage, { workspace, harness, model: model.trim(), effort });
      window.location.hash = "#/sessions/" + encodeURIComponent(session.ID);
    } catch (err) {
      setFailure(message(err));
      setBusy(false);
    }
  }

  const harnessDefault = defaults.find((h) => h.harness === harness);
  const defaultModels = Object.fromEntries(defaults.map((h) => [h.harness, h.default_model ?? ""]));
  const roots = workspaces.state === "ready" ? workspaces.list.workspaces : [];
  const canStart = !busy && !!workspace && resolution.state !== "bad" && !untrusted;

  const Root = atHome ? "div" : "main";
  const onKey = (ev: KeyboardEvent<HTMLTextAreaElement>) => {
    if (ev.key !== "Enter" || ev.shiftKey || ev.nativeEvent.isComposing || ev.keyCode === 229) {
      return;
    }
    void submit(ev);
  };

  return (
    <Root className={"screen new-home" + (atHome ? " at-home" : "")}>
      {atHome ? null : (
        <a className="back" href="#/sessions">
          <span aria-hidden="true">{"‹ "}</span>
          Sessions
        </a>
      )}
      <h1>What should the agent do?</h1>
      <LocalHooksBanner api={api} />
      {workspaces.state === "failed" ? (
        <div className="error" role="alert">
          <p>{"Could not load workspaces: " + workspaces.message}</p>
          <button type="button" className="retry" onClick={() => {
              setWorkspaces({ state: "loading" });
              setAttempt((n) => n + 1);
            }}>
            Retry now
          </button>
        </div>
      ) : null}
      {workspaces.state === "ready" && roots.length === 0 ? <p className="muted">No workspaces on this server yet. Add a folder of the server.</p> : null}
      {untrusted ? (
        <div className="notice" role="alert" aria-label={"Trust " + baseName(untrusted) + " for Claude?"}>
          <span className="dot wait" />
          <span>{"Trust " + baseName(untrusted) + " for Claude? Claude asks one time for each folder. If you do not trust it, Claude stops at the first message."}</span>
          <span className="spacer" />
          <Button variant="primary" className="sm" onClick={trust}>
            Trust
          </Button>
        </div>
      ) : null}
      {trustError ? (
        <p className="error" role="status">
          {trustError}
        </p>
      ) : null}
      <form className="composer-box new-composer" onSubmit={(e) => void submit(e)}>
        <textarea aria-label="Task" rows={2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} placeholder="Describe the task, or paste a PR or issue URL" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-describedby="resolution" />
        <div id="resolution" className="resolution">
          {resolution.state === "checking" ? <p className="resolution-line muted">Checking…</p> : null}
          {resolution.state === "ok" ? (
            <p className="resolution-line" data-testid="resolution-line">
              <span className="dot ok" aria-hidden="true" />
              <span>{(resolution.item.title || item) + " " + placeLine(resolution.item, home)}</span>
            </p>
          ) : null}
          {resolution.state === "bad" ? (
            <div className="error" role="alert">
              {resolution.message}
            </div>
          ) : null}
        </div>
        <div className="composer-foot">
          <Select className="chip-select" label="Project" value={workspace} onChange={setWorkspace} disabled={roots.length === 0} search={roots.length > 8 ? "Find a project…" : undefined} options={roots.map((w) => ({ value: w.Root, label: baseName(w.Root), hint: w.Root }))} />
          <Select className="chip-select" label="Agent" value={agentValue(harness, model)} onChange={chooseAgent} options={agentChoices(defaultModels, model ? { harness, model } : null)} />
          <Select className="chip-select" label="Effort" value={effort} onChange={setEffort} options={[{ value: "", label: "effort " + defaultLabel(harnessDefault?.default_effort) }, ...effortChoices.map((e) => ({ value: e, label: "effort " + e }))]} />
          <span className="spacer" />
          <button type="submit" className="send" aria-label="Start session" disabled={!canStart}>
            ↑
          </button>
        </div>
      </form>
      <p className="hint" data-testid="new-hint">
        <kbd>Enter</kbd> start · project, agent and effort are remembered from your last session
      </p>
      {failure ? (
        <div className="error" role="alert">
          <pre>{failure}</pre>
        </div>
      ) : null}
      {busy ? <p className="muted" role="status">Starting…</p> : null}
      <div className="workspace-tools">
        <button type="button" className="ui btn quiet" onClick={() => setAdding((v) => !v)}>
          Add workspace…
        </button>
        <button type="button" className="ui btn quiet" onClick={() => setRemoving(true)} disabled={!workspace}>
          Remove workspace
        </button>
      </div>
      {adding ? (
        <form className="add-workspace" onSubmit={submitWorkspace}>
          <label>
            Folder on the server
            <input
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              placeholder={home ? home + "/project" : "/home/me/project"}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          {newPath.trim() ? <p className="muted mono">{expandPath(newPath, home)}</p> : null}
          {addError ? (
            <div className="error" role="alert">
              {addError}
            </div>
          ) : null}
          <button type="submit" disabled={!newPath.trim()}>
            Add
          </button>
        </form>
      ) : null}
      {removing && workspace ? (
        <div className="confirm" role="alertdialog" aria-label={"Remove " + workspace + " from crew?"}>
          <p>{"Remove " + workspace + " from crew?"}</p>
          <p className="muted">crew stops using this workspace. No files, worktrees or branches on the server change.</p>
          {removeError ? (
            <div className="error" role="alert">
              {removeError}
            </div>
          ) : null}
          <button type="button" className="secondary" onClick={() => setRemoving(false)}>
            Cancel
          </button>
          <button type="button" className="danger" aria-label={"Remove " + workspace} onClick={confirmRemove}>
            Remove
          </button>
        </div>
      ) : null}
    </Root>
  );
}
