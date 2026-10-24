import type { Completion } from "./pathSuggest";
import type { ToneAxis } from "./faces";
import type { CleanupItem, DiskView } from "./disk";
import type { Message } from "./stream";

export type Hello = {
  api: string;
  build: string;
};

export type Device = {
  id: string;
  name: string;
  created_at: string;
  last_seen: string;
};

export type Paired = {
  device: Device;
  token: string;
};

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const codeByStatus: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  404: "not_found",
  429: "rate_limited",
};

function errorFields(body: unknown): { code?: string; message?: string } {
  if (typeof body !== "object" || body === null) {
    return {};
  }
  const record = body as Record<string, unknown>;
  const nested = record.error;
  if (typeof nested === "object" && nested !== null) {
    return errorFields(nested);
  }
  return {
    code: typeof record.code === "string" ? record.code : undefined,
    message: typeof record.message === "string" ? record.message : typeof nested === "string" ? nested : undefined,
  };
}

async function request<T>(fetchFn: Fetch, path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetchFn(path, { cache: "no-store", ...init });
  } catch (err) {
    throw new ApiError(0, "network", err instanceof Error ? err.message : String(err));
  }
  const text = await res.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const fields = errorFields(body);
    const code = fields.code ?? codeByStatus[res.status] ?? "failed";
    throw new ApiError(res.status, code, fields.message ?? (text || res.statusText));
  }
  return body as T;
}

export function hello(fetchFn: Fetch): Promise<Hello> {
  return request<Hello>(fetchFn, "/api/v1/hello");
}

export function pair(fetchFn: Fetch, code: string, name: string): Promise<Paired> {
  return request<Paired>(fetchFn, "/api/v1/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name }),
  });
}

export type Authed = { fetch: Fetch; token: string };

export type MessagesPage = { messages: Message[]; before: number };

export type Sent = { id: string; queued: boolean };

function sessionPath(session: string, rest: string): string {
  return "/api/v1/sessions/" + encodeURIComponent(session) + rest;
}

function authedRequest<T>(a: Authed, path: string, method = "GET", body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Authorization: "Bearer " + a.token };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  return request<T>(a.fetch, path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

export function messagesPage(a: Authed, session: string, before?: number, limit = 50): Promise<MessagesPage> {
  const query = (before ? "before=" + before + "&" : "") + "limit=" + limit;
  return authedRequest<MessagesPage>(a, sessionPath(session, "/messages?" + query));
}

export function sendMessage(a: Authed, session: string, text: string): Promise<Sent> {
  return authedRequest<Sent>(a, sessionPath(session, "/messages"), "POST", { text });
}

export async function unsend(a: Authed, session: string, id: string): Promise<void> {
  await authedRequest<unknown>(a, sessionPath(session, "/sends/" + encodeURIComponent(id)), "DELETE");
}

export async function markRead(a: Authed, session: string): Promise<void> {
  await authedRequest<unknown>(a, sessionPath(session, "/read"), "POST");
}

export async function interrupt(a: Authed, session: string): Promise<void> {
  await authedRequest<unknown>(a, sessionPath(session, "/interrupt"), "POST");
}

export async function sessionPane(a: Authed, session: string, kind: "shell" | "nvim"): Promise<string> {
  const res = await authedRequest<{ pane?: unknown }>(a, sessionPath(session, "/" + kind), "POST", {});
  if (typeof res?.pane !== "string" || !res.pane) {
    throw new ApiError(0, "failed", "The server did not give a pane.");
  }
  return res.pane;
}

export type PromptChoice = {
  id: string;
  label: string;
};

export type Prompt = {
  id?: string;
  text: string;
  choices: PromptChoice[];
  raw?: string;
};

export function getPrompt(a: Authed, session: string): Promise<Prompt> {
  return authedRequest<Prompt>(a, sessionPath(session, "/prompt"));
}

export async function answerPrompt(a: Authed, session: string, choice: string, prompt?: string): Promise<void> {
  await authedRequest<unknown>(a, sessionPath(session, "/answer"), "POST", prompt ? { choice, prompt } : { choice });
}

export type PushKey = {
  public_key: string;
};

export type PushSubscriptionBody = {
  endpoint?: string;
  expirationTime?: number | null;
  keys?: Record<string, string>;
};

function authorized(token: string, init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: "Bearer " + token } };
}

export function pushKey(fetchFn: Fetch, token: string): Promise<PushKey> {
  return request<PushKey>(fetchFn, "/api/v1/push/key", authorized(token));
}

export function pushSubscribe(fetchFn: Fetch, token: string, subscription: PushSubscriptionBody): Promise<unknown> {
  return request<unknown>(
    fetchFn,
    "/api/v1/push/subscribe",
    authorized(token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription),
    }),
  );
}

export function pushUnsubscribe(fetchFn: Fetch, token: string): Promise<unknown> {
  return request<unknown>(fetchFn, "/api/v1/push/unsubscribe", authorized(token, { method: "POST" }));
}

export function unpairDevice(fetchFn: Fetch, token: string): Promise<unknown> {
  return request<unknown>(fetchFn, "/api/v1/unpair", authorized(token, { method: "POST" }));
}

export function apiVersion(h: Hello): string {
  const v = String(h.api);
  return v.startsWith("v") ? v : "v" + v;
}

export type WorkspaceInfo = {
  Root: string;
  Kind: string;
  LastUsed: string;
};

export type WorkspaceList = {
  workspaces: WorkspaceInfo[];
  last_used: string;
};

export type WorkItemResolved = {
  source: string;
  ref?: string;
  title?: string;
  worktree: string;
  workspace: string;
};

export type HarnessOptions = {
  harness: string;
  models?: string[];
  efforts?: string[];
  default_model?: string;
  default_effort?: string;
};

export type SessionOptions = {
  harnesses: HarnessOptions[];
  home?: string;
};

export function sessionOptions(fetchFn: Fetch, token: string): Promise<SessionOptions> {
  return request<SessionOptions>(fetchFn, "/api/v1/session-options", authed(token));
}

export type NewSessionRequest = {
  workspace?: string;
  work_item: string;
  harness: string;
  model?: string;
  effort?: string;
  prompt?: string;
};

function authed(token: string, init: RequestInit = {}): RequestInit {
  const headers: Record<string, string> = { Authorization: "Bearer " + token };
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  return { ...init, headers };
}

export function listWorkspaces(fetchFn: Fetch, token: string): Promise<WorkspaceList> {
  return request<WorkspaceList>(fetchFn, "/api/v1/workspaces", authed(token));
}

export function addWorkspace(fetchFn: Fetch, token: string, path: string): Promise<WorkspaceInfo> {
  return request<WorkspaceInfo>(fetchFn, "/api/v1/workspaces", authed(token, { method: "POST", body: JSON.stringify({ path }) }));
}

export function removeWorkspace(fetchFn: Fetch, token: string, root: string): Promise<unknown> {
  return request<unknown>(fetchFn, "/api/v1/workspaces/remove", authed(token, { method: "POST", body: JSON.stringify({ root }) }));
}

export function expandPath(input: string, home: string): string {
  const path = input.trim();
  if (path === "~") {
    return home;
  }
  if (path.startsWith("~/")) {
    return home.replace(/\/$/, "") + path.slice(1);
  }
  if (!path.startsWith("/") && home) {
    return home.replace(/\/$/, "") + "/" + path;
  }
  return path;
}

export function resolveWorkItem(fetchFn: Fetch, token: string, workspace: string, item: string): Promise<WorkItemResolved> {
  const query = new URLSearchParams({ workspace, item }).toString();
  return request<WorkItemResolved>(fetchFn, "/api/v1/work-items/resolve?" + query, authed(token));
}

export function startSession(fetchFn: Fetch, token: string, body: NewSessionRequest): Promise<{ ID: string }> {
  return request<{ ID: string }>(fetchFn, "/api/v1/sessions", authed(token, { method: "POST", body: JSON.stringify(body) }));
}

export async function tokenRefused(fetchFn: Fetch, token: string): Promise<boolean> {
  try {
    await listWorkspaces(fetchFn, token);
    return false;
  } catch (err) {
    return err instanceof ApiError && err.status === 401 && err.code === "unauthorized";
  }
}

export type Automation = {
  name: string;
  agent: string;
  mate?: string;
  model?: string;
  effort?: string;
  target?: string;
  prompt: string;
  schedule?: string;
  on?: string[];
  timezone?: string;
  precheck?: string;
  session?: string;
  browser?: string;
  filter?: { repo?: string; branch?: string; author?: string };
  enabled: boolean;
  source: string;
};

export function saveAutomation(a: Authed, automation: Omit<Automation, "source">): Promise<Automation> {
  return authedRequest<Automation>(a, "/api/v1/automations", "POST", { automation });
}

export function rerunAutomation(a: Authed, run: string): Promise<{ run: AutomationRun }> {
  return authedRequest<{ run: AutomationRun }>(a, "/api/v1/automations/runs/" + encodeURIComponent(run) + "/rerun", "POST");
}

export type AutomationList = { automations: Automation[]; problems?: string[] };

export type AutomationRun = {
  id: string;
  automation: string;
  trigger?: string;
  outcome: string;
  reason?: string;
  session_id?: string;
  start?: string;
  end?: string;
};

export function automationRuns(a: Authed, limit = 100): Promise<{ runs: AutomationRun[] }> {
  return authedRequest<{ runs: AutomationRun[] }>(a, "/api/v1/automations/runs?limit=" + limit);
}

export function listAutomations(a: Authed): Promise<AutomationList> {
  return authedRequest<AutomationList>(a, "/api/v1/automations");
}

export function runAutomation(a: Authed, name: string, body: { context: string; work_item: string }): Promise<{ run: AutomationRun }> {
  return authedRequest<{ run: AutomationRun }>(a, "/api/v1/automations/" + encodeURIComponent(name) + "/run", "POST", body);
}

export type ApprovalAction = { Kind: string; Tool: string; Input: string };

export type Approval = {
  ID: string;
  SessionID: string;
  Mate: string;
  Requester: string;
  Action: ApprovalAction;
  At: string;
  State: string;
};

export async function listApprovals(a: Authed): Promise<Approval[]> {
  return (await authedRequest<Approval[] | null>(a, "/api/v1/approvals")) ?? [];
}

export function decideApproval(a: Authed, id: string, approve: boolean): Promise<Approval> {
  return authedRequest<Approval>(a, "/api/v1/approvals/" + encodeURIComponent(id) + (approve ? "/approve" : "/deny"), "POST");
}

export type Mate = {
  name: string;
  prompt: string;
  agent: string;
  model?: string;
  effort?: string;
  repos?: string[];
  owner?: string;
  avatar?: string;
  color?: string;
  tone?: Record<string, number>;
  env?: string;
  enabled: boolean;
};

export type MateLimits = { hop_limit: number; turns_per_hour: number; daily_turns: number; daily_tokens: number; stop: boolean };

export type MateList = { mates: Mate[]; problems?: string[]; limits: MateLimits; tones?: ToneAxis[] };

export type MateSetup = { manifest: string; url: string };

export type MateClaim = { name: string; code: string; expires_at: string };

function matePath(name: string, verb: string): string {
  return "/api/v1/mates/" + encodeURIComponent(name) + "/" + verb;
}

export function listMates(a: Authed): Promise<MateList> {
  return authedRequest<MateList>(a, "/api/v1/mates");
}

export function saveMate(a: Authed, mate: Mate): Promise<Mate> {
  return authedRequest<Mate>(a, "/api/v1/mates", "POST", { mate });
}

export function pauseMate(a: Authed, name: string, pause: boolean): Promise<Mate> {
  return authedRequest<Mate>(a, matePath(name, pause ? "pause" : "resume"), "POST");
}

export function stopAllMates(a: Authed, stop: boolean): Promise<MateLimits> {
  return authedRequest<MateLimits>(a, "/api/v1/mates/stop", "POST", { stop });
}

export function mateSetup(a: Authed, name: string): Promise<MateSetup> {
  return authedRequest<MateSetup>(a, matePath(name, "setup"));
}

export function setMateTokens(a: Authed, name: string, bot: string, app: string): Promise<unknown> {
  return authedRequest<unknown>(a, matePath(name, "tokens"), "POST", { bot_token: bot, app_token: app });
}

export function claimMate(a: Authed, name: string): Promise<MateClaim> {
  return authedRequest<MateClaim>(a, matePath(name, "claim"), "POST");
}

export type MateMemory = { name: string; path: string; text: string; limit: number };

export function newMateConversation(a: Authed, name: string): Promise<{ ID: string }> {
  return authedRequest<{ ID: string }>(a, matePath(name, "new"), "POST", {});
}

export function mateMemory(a: Authed, name: string): Promise<MateMemory> {
  return authedRequest<MateMemory>(a, matePath(name, "memory"));
}

export function setMateMemory(a: Authed, name: string, text: string): Promise<MateMemory> {
  return authedRequest<MateMemory>(a, matePath(name, "memory"), "POST", { text });
}

export function diskView(a: Authed): Promise<DiskView> {
  return authedRequest<DiskView>(a, "/api/v1/disk");
}

export function cleanupRun(a: Authed): Promise<{ items: CleanupItem[] }> {
  return authedRequest<{ items: CleanupItem[] }>(a, "/api/v1/cleanup/run", "POST");
}

export function cleanupWorktree(a: Authed, path: string, backup: boolean): Promise<CleanupItem> {
  return authedRequest<CleanupItem>(a, "/api/v1/cleanup/worktree", "POST", { path, backup });
}

export function killPorts(a: Authed, pgids: number[]): Promise<{ killed: number[] }> {
  return authedRequest<{ killed: number[] }>(a, "/api/v1/ports/kill", "POST", { pgids });
}

export type HeadlessView = { live: boolean; png?: string; width?: number; height?: number };

export function headlessView(a: Authed, session: string): Promise<HeadlessView> {
  return authedRequest<HeadlessView>(a, sessionPath(session, "/browser"));
}

export function sendCookies(a: Authed, file: string): Promise<{ imported: number; total: number }> {
  return authedRequest<{ imported: number; total: number }>(a, "/api/v1/browser/cookies", "POST", { file });
}

export function openShell(a: Authed, session: string, worktree: string): Promise<{ pane: string }> {
  return authedRequest<{ pane: string }>(a, sessionPath(session, "/shell"), "POST", { worktree });
}

export function startFresh(a: Authed, session: string, sameWorktree: boolean): Promise<{ ID: string }> {
  return authedRequest<{ ID: string }>(a, sessionPath(session, "/fresh"), "POST", { same_worktree: sameWorktree });
}

export type ConfigValues = { path: string; values: Record<string, string> };

export type HarnessSetup = { installed: boolean; file: string; backup?: string; err?: string };

export type NvimSetup = { on_path: boolean; configured: boolean; config_file: string; plugin_dir: string; plugin_found: boolean };

export type Onboarding = { done: boolean; harnesses: Record<string, HarnessSetup>; nvim: NvimSetup };

export type DirChild = { Name: string; Path: string };

export type PairCode = { code: string; expires_at: string };

export type HarnessChoices = { harness: string; name?: string; models?: string[]; efforts?: string[]; default_model?: string; default_effort?: string };

export function getConfig(a: Authed): Promise<ConfigValues> {
  return authedRequest<ConfigValues>(a, "/api/v1/config");
}

export function setConfig(a: Authed, key: string, value: string): Promise<ConfigValues> {
  return authedRequest<ConfigValues>(a, "/api/v1/config", "POST", { key, value });
}

export function getOnboarding(a: Authed): Promise<Onboarding> {
  return authedRequest<Onboarding>(a, "/api/v1/onboarding");
}

export function setHooks(a: Authed, harness: string, install: boolean): Promise<HarnessSetup> {
  return authedRequest<HarnessSetup>(a, "/api/v1/onboarding/" + (install ? "install" : "remove"), "POST", { harness });
}

export function getHooks(a: Authed): Promise<{ missing: HooksMissing[] }> {
  return authedRequest<{ missing: HooksMissing[] }>(a, "/api/v1/hooks");
}

export function fixHooks(a: Authed, env: string, harness: string): Promise<{ missing: HooksMissing[] }> {
  return authedRequest<{ missing: HooksMissing[] }>(a, "/api/v1/hooks/fix", "POST", { env, harness });
}

export function setUpNvim(a: Authed): Promise<NvimSetup> {
  return authedRequest<NvimSetup>(a, "/api/v1/onboarding/nvim", "POST");
}

export function fsComplete(a: Authed, path: string): Promise<Completion> {
  return authedRequest<Completion>(a, "/api/v1/fs/complete?path=" + encodeURIComponent(path));
}

export function workspaceDirs(a: Authed, path: string): Promise<{ dirs: DirChild[] | null }> {
  return authedRequest<{ dirs: DirChild[] | null }>(a, "/api/v1/workspaces/dirs?path=" + encodeURIComponent(path));
}

export function listDevices(a: Authed): Promise<{ devices: Device[] }> {
  return authedRequest<{ devices: Device[] }>(a, "/api/v1/devices");
}

export async function revokeDevice(a: Authed, id: string): Promise<void> {
  await authedRequest<unknown>(a, "/api/v1/devices/" + encodeURIComponent(id) + "/revoke", "POST");
}

export function newPairCode(a: Authed): Promise<PairCode> {
  return authedRequest<PairCode>(a, "/api/v1/pair/code", "POST");
}

export const unknownMethodNote = "This server does not have this setting. Update crew on the server to change it here.";
export const ownerNote = "Only the owner device, the app on the computer that runs crew, can change this.";

export function groupNote(err: unknown): string {
  if (err instanceof ApiError && err.code === "unknown_method") {
    return unknownMethodNote;
  }
  if (err instanceof ApiError && err.code === "forbidden") {
    return ownerNote;
  }
  return err instanceof Error ? err.message : String(err);
}

export function openReview(a: Authed, session: string, scope: string, worktree: string): Promise<unknown> {
  const q = new URLSearchParams();
  if (scope) {
    q.set("scope", scope);
  }
  if (worktree) {
    q.set("worktree", worktree);
  }
  const query = q.toString();
  return authedRequest<unknown>(a, sessionPath(session, "/review" + (query ? "?" + query : "")));
}

export async function markViewed(a: Authed, session: string, mark: { Worktree: string; Path: string; Blob: string }, viewed: boolean): Promise<void> {
  await authedRequest<unknown>(a, sessionPath(session, "/review/viewed"), "POST", { mark, viewed });
}

export type ReviewCommentBody = { worktree: string; path: string; start_line: number; end_line: number; code: string; body: string; removed: boolean };

export function addReviewComment(a: Authed, session: string, body: ReviewCommentBody): Promise<unknown> {
  return authedRequest<unknown>(a, sessionPath(session, "/review/comments"), "POST", body);
}

export function sendReview(a: Authed, session: string, note: string): Promise<unknown> {
  return authedRequest<unknown>(a, sessionPath(session, "/review/send"), "POST", { note });
}

export async function applyHunk(a: Authed, session: string, body: { worktree: string; file: unknown; hunk: number; action: "stage" | "revert" }): Promise<void> {
  await authedRequest<unknown>(a, sessionPath(session, "/review/hunk"), "POST", body);
}

export type SwitchKind = "model" | "effort";

export async function renameSession(a: Authed, session: string, name: string): Promise<void> {
  await authedRequest<unknown>(a, sessionPath(session, "/rename"), "POST", { name });
}

export async function muteSession(a: Authed, session: string, muted: boolean): Promise<void> {
  await authedRequest<unknown>(a, sessionPath(session, "/mute"), "POST", { muted });
}

export async function switchSession(a: Authed, session: string, kind: SwitchKind, value: string): Promise<void> {
  await authedRequest<unknown>(a, sessionPath(session, "/switch"), "POST", { kind, value });
}

export async function endSession(a: Authed, session: string): Promise<void> {
  await authedRequest<unknown>(a, sessionPath(session, "/end"), "POST");
}

export async function resumeSession(a: Authed, session: string): Promise<void> {
  await authedRequest<unknown>(a, sessionPath(session, "/resume"), "POST");
}

export function killDevServers(a: Authed, session: string): Promise<{ killed: number[] }> {
  return authedRequest<{ killed: number[] }>(a, sessionPath(session, "/kill-dev-servers"), "POST");
}

export type EnvSecret = { name: string; set: boolean };

export type EnvInfo = {
  name: string;
  kind: "local" | "custom";
  parts: string[];
  secrets: EnvSecret[];
  public_key?: string;
  new_public_key?: string;
  key_created?: string;
  git_name?: string;
  git_email?: string;
  codex_login?: boolean;
  pi_login?: boolean;
  used_by: string[];
  local?: EnvLocal;
  hooks_missing?: HooksMissing[];
};

export type HooksMissing = { env: string; harness: string; file: string; reason: string };

export type EnvLocal = {
  git_name: string;
  git_email: string;
  ssh_agent: boolean;
  ssh_keys: number;
  github: boolean;
  github_user: string;
  claude: boolean;
  codex: boolean;
  pi: boolean;
};

export type EnvCreate = { name: string; kind: "local" | "custom"; parts?: string[]; git_name?: string; git_email?: string };

export type EnvChange = { parts?: string[]; git_name?: string; git_email?: string; secret?: string; value?: string };

function envPath(name: string, verb = ""): string {
  return "/api/v1/envs/" + encodeURIComponent(name) + (verb ? "/" + verb : "");
}

export function listEnvs(a: Authed): Promise<{ envs: EnvInfo[] }> {
  return authedRequest<{ envs: EnvInfo[] }>(a, "/api/v1/envs");
}

export function getEnv(a: Authed, name: string): Promise<EnvInfo> {
  return authedRequest<EnvInfo>(a, envPath(name));
}

export function createEnv(a: Authed, body: EnvCreate): Promise<EnvInfo> {
  return authedRequest<EnvInfo>(a, "/api/v1/envs", "POST", body);
}

export function setEnv(a: Authed, name: string, change: EnvChange): Promise<EnvInfo> {
  return authedRequest<EnvInfo>(a, envPath(name), "POST", change);
}

export function unsetEnvSecret(a: Authed, name: string, secret: string): Promise<EnvInfo> {
  return authedRequest<EnvInfo>(a, envPath(name, "unset"), "POST", { secret });
}

export function deleteEnv(a: Authed, name: string): Promise<EnvInfo> {
  return authedRequest<EnvInfo>(a, envPath(name), "DELETE");
}

export function envSSHKey(a: Authed, name: string, action: "make" | "rotate" | "confirm" | "cancel"):Promise<EnvInfo> {
  return authedRequest<EnvInfo>(a, envPath(name, "ssh-key"), "POST", { action });
}
