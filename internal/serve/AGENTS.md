# internal/serve

`crew serve` is the HTTP and WebSocket API that the phone app (PWA) talks to. It is a separate process. It gets to the daemon only through `rpc`. It gives an allowlist of the daemon methods, never a passthrough. See [ADR 0046](../../docs/adr/0046-remote-app.md). Pairing and revocation on the daemon side are in [internal/daemon/](../daemon/AGENTS.md).

Tests:

- `go test ./internal/serve/ ./cmd/crew/ -run Serve`: an in-memory daemon fake in `fakes_test.go`, `httptest` and a real WebSocket client.
- `go test -tags integration ./test/integration/ -run ServeAgainst`: a real daemon with SQLite.

Golden responses are in `testdata/`. To make them again, run `go test ./internal/serve -update`, then review the diff. A changed golden is a changed API.

## Layers

- depguard: from `internal/`, `internal/serve` imports only `rpc`, `domain`, `view` and `syntax`. It also imports the standard library and `github.com/coder/websocket`. It does not import `os/exec`. `cmd/crew/serve.go` parses the flags and reads `[serve] url`. It passes a `Dial` that starts the daemon as the TUI does (`rpc.Connect` with `spawn`).
- `serve.Daemon` is the part of `*rpc.Client` that serve uses (`Call`, `Subscribe`, `WatchTranscript`, `Close`). Each HTTP request dials its own connection and closes it. Each stream has its own connection. Thus a slow phone never stops the reader of a different client.

## Listening

- `serve.Options{Addr, Cert, Key, SelfSigned, CertDir}`. `Check` is the rule: plain HTTP only on a loopback address (`localhost`, `127.0.0.0/8`, `::1`), for all values of the other flags. Use `--cert` and `--key` together. `--self-signed` replaces them.
- `--self-signed` keeps `cert.pem` and `key.pem` (600) in `$CREW_HOME/serve`.
  - The certificate is valid for 5 years. It covers `localhost`, `127.0.0.1`, `::1`, `host.docker.internal`, the hostname and the `--addr` host.
  - serve uses it again while it has 30 days or more left and covers the address. Thus a proxy that trusts it continues to work after restarts.
  - serve replaces it for a new `--addr` host, or near expiry. Then set the proxy to trust the new certificate.
- `Server.Start(ctx)` opens the revocation `subscribe` connection. Call it before you serve. It fails when the daemon is not reachable. After the daemon restarts, it subscribes again every second. A cancel of `ctx` closes all open streams with 1001.

## Log

`Config.Log` (stdout under `crew serve`) gets one line for these events:

- A stream that closes with a code that is not 1000 or 1001: `stream closed <code> from <addr>: <reason>`.
- A 401 response: `<method> <path> 401 unauthorized from <addr>: <message>`. The path does not include its query.

The log never contains a token. It writes a maximum of `LogBurst` (20) lines for each `LogWindow` (1 min). The first line of the next window tells how many lines were dropped. `Config.Now` sets the clock for tests.

## HTTP API (`/api/v1`)

Each response is JSON with `Cache-Control: no-store`. An error is `{"error":{"code","message"}}` with the `rpc` code of the daemon and an HTTP status:

- `bad_request` 400, `unauthorized` 401, `forbidden` 403, `not_found` 404, `stale` 409, `in_use` 409, `wrong_machine` 409, `rate_limited` 429.
- `failed`/`launch_failed` 500, `unknown_method` 501, `version_mismatch` 502.
- `unavailable` 503. This status also applies when the daemon is not reachable.

Unknown paths under `/api/` answer `not_found`.

| Endpoint | Auth | Daemon method | Body → response |
|---|---|---|---|
| `GET /api/v1/hello` | no | none | → `{"api":"v1","build","machine":{"id","name"}}` (serve's build, which is the daemon's; `machine` comes from the `status` of the daemon when serve starts, ADR 0063) |
| `POST /api/v1/pair` | no | `pair.redeem` | `{"code","name"}` → `{"device":{"id","name","created_at","last_seen"},"token"}` |
| `GET /api/v1/workspaces` | yes | `workspace.list` | → `{"workspaces":[Workspace],"last_used"}` |
| `POST /api/v1/workspaces` | yes | `workspace.add` | `{"path"}` (absolute, or it starts with `~`, which the daemon changes to its HOME; not blank, no other keys) → the `Workspace` |
| `POST /api/v1/workspaces/remove` | yes | `workspace.remove` | `{"root"}` (not blank, no other keys) → `{}`; no files, worktrees or branches change |
| `GET /api/v1/session-options` | yes | `session.options` | → `{"harnesses":[{"harness","name","tag","models","efforts","model","effort","default_model","default_effort"}],"home"}`; the new-session form shows `default (<value>)` |
| `GET /api/v1/automations` | yes | `automation.list` | → `{"automations":[Automation],"problems"}` |
| `GET /api/v1/automations/runs?name=&limit=` | yes | `automation.runs` | → `{"runs":[AutomationRun]}`, newest first; both query values optional |
| `POST /api/v1/automations/{name}/run` | yes | `automation.run` | `{"context","work_item"}` (both optional, no other keys: a phone cannot rerun or pick a repo) → `{"run","session"}` |
| `POST /api/v1/automations` | owner | `automation.save` | `{"automation"}` (a name that is not blank, no other keys) → the saved `Automation`; it writes `config.toml` |
| `POST /api/v1/automations/runs/{id}/rerun` | owner | `automation.run` | → `{"run","session"}`; runs again with the context, work item and repo of run `id` |
| `POST /api/v1/sessions` | yes | `session.new` | `{"workspace","work_item","harness","model","effort","prompt"}` (`harness` required; the rest optional. An empty `work_item` starts a session that is named from its first prompt) → the new `Session`; a setup recipe failure is `failed` with its output in `message` |
| `GET /api/v1/work-items/resolve?workspace=&item=` | yes | `session.resolve` | → `{"source","ref","title","worktree","workspace","dir","git"}` (`worktree` is empty when no worktree is made; `dir` is where the session runs; `git` is false for a folder with no repo); `bad_request` for an empty item or an unsupported link, `not_found` for an unknown workspace or an item the tracker does not know |
| `GET /api/v1/sessions/{id}/messages?before=&limit=` | yes | `transcript.page` | → `{"messages":[Message],"before"}`; both query values optional integers |
| `POST /api/v1/sessions/{id}/end` | yes | `session.end` | → the ended `Session` |
| `POST /api/v1/sessions/{id}/resume` | yes | `session.resume` | → the resumed `Session` |
| `POST /api/v1/sessions/{id}/mute` | yes | `session.mute` | `{"muted":bool}` (required) → `{}` |
| `POST /api/v1/sessions/{id}/rename` | yes | `session.rename` | `{"name"}` → `{}` |
| `POST /api/v1/sessions/{id}/switch` | yes | `session.switch` | `{"kind","value"}` (`kind` is `model` or `effort`, `value` not blank, no other keys) → the `Session` |
| `POST /api/v1/sessions/{id}/kill-dev-servers` | yes | `subscribe`, `ports.kill` | → `{"killed":[pgid]}`; serve reads the ports of the worktrees of the session from the daemon state and kills their process groups. With no ports, it calls nothing and answers `{"killed":[]}`. The phone never sends process groups |
| `POST /api/v1/sessions/{id}/messages` | yes | `session.send` | `{"text"}` (not blank) → `{"id","queued"}`; a queued send shows in the stream's `sends` until it is pasted |
| `DELETE /api/v1/sessions/{id}/sends/{send}` | yes | `session.unsend` | → `{}`; `not_found` once the send has gone out (it left `sends`) |
| `POST /api/v1/sessions/{id}/interrupt` | yes | `session.interrupt` | → `{}` |
| `GET /api/v1/sessions/{id}/prompt` | yes | `session.prompt` | → `{"id","text","choices":[{"id","label"}],"raw"}` (`id` identifies the dialog shown: a hash of its text and choices); `raw` (the last 40 visible pane lines, with empty `text` and `choices`) comes when the session is in `permission` but its dialog is not recognized; `not_found` when no dialog is showing |
| `POST /api/v1/sessions/{id}/answer` | yes | `session.answer` | `{"choice","prompt"}` (a choice `id` from the prompt, not blank; `prompt` is the prompt `id` that was shown) → `{}`; `stale` (409) when the session is no longer in `permission` or the dialog showing is not the `prompt` given, in which case nothing was sent |
| `GET /api/v1/push/key` | yes | `push.key` | → `{"public_key"}`, the VAPID public key (base64url), for `pushManager.subscribe` |
| `POST /api/v1/push/subscribe` | yes | `push.subscribe` | the browser's `PushSubscription.toJSON()` (`{"endpoint","keys":{"p256dh","auth"}}`) → `{}`; stored with the calling device |
| `POST /api/v1/push/unsubscribe` | yes | `push.unsubscribe` | → `{}`; drops the calling device's subscription (the app's sign out) |
| `POST /api/v1/unpair` | yes | `device.revoke` | → `{}`; revokes the calling device (the app's sign out) |
| `GET /api/v1/approvals` | yes | `approval.list` | → `[Approval]`, the pending approvals of mates, oldest first (`[]` when none) |
| `POST /api/v1/approvals/{id}/approve` | yes | `approval.decide` | → the granted `Approval`; `stale` (409) when it is decided or expired, `not_found` for an unknown ID |
| `POST /api/v1/approvals/{id}/deny` | yes | `approval.decide` | → the denied `Approval`; the same errors |
| `GET /api/v1/mates` | yes | `mate.list` | → `{"mates","problems","states","limits"}`, the definitions of the mates (`[]` when none) |
| `POST /api/v1/mates` | yes | `mate.set` | `{"mate","environment":{"machine_id","identity_id"}}` (`environment` optional) → the saved mate; adds a mate or changes its settings, also its `env`. A different `machine_id` gets `wrong_machine` (409) |
| `POST /api/v1/mates/stop` | yes | `mate.stop_all` | `{"stop"}` → the limits; the kill switch for all mates |
| `POST /api/v1/mates/{name}/pause` | yes | `mate.pause` | → the saved mate |
| `POST /api/v1/mates/{name}/resume` | yes | `mate.resume` | → the saved mate |
| `GET /api/v1/mates/{name}/setup` | yes | `mate.setup` | → `{"manifest","url"}`, the Slack app manifest and its link |
| `POST /api/v1/mates/{name}/tokens` | yes | `mate.set_tokens` | `{"bot_token","app_token"}` → `{"name","has_bot_token","has_app_token"}`; the name comes from the path, and no response holds a token |
| `POST /api/v1/mates/{name}/claim` | yes | `mate.claim` | → `{"name","code","expires_at"}`, the one-time owner code |
| `POST /api/v1/mates/{name}/new` | yes | `mate.new` | `{"repo","prompt"}` (both optional, the body can be empty) → the new session |
| `GET /api/v1/mates/{name}/memory` | yes | `mate.memory` | → `{"name","path","text","limit"}` |
| `GET /api/v1/mates/{name}/export` | yes | `mate.export` | → `{"mate","memory"}`: the role, the look, the harness and the memory text (ADR 0063). No token, no owner, no environment and no conversation |
| `POST /api/v1/mates/import` | yes | `mate.import` | `{"export","environment":{"machine_id","identity_id"}}` → the new mate; a used name gets the next free number (`ada-2`); a different `machine_id` gets `wrong_machine` (409) |
| `POST /api/v1/mates/{name}/memory` | yes | `mate.set_memory` | `{"text"}` → the same; an empty text clears the memory |
| `GET /api/v1/environments` | yes | `environment.list` | → `{"machine":{"id","name"},"identities":[EnvInfo],"found"}` (ADR 0063); no secret value |
| `POST /api/v1/identities/{name}` | yes | `identity.set` | `{"kind","parts","git_name","git_email"}` → the `EnvInfo`; it makes the identity or changes it |
| `DELETE /api/v1/identities/{name}` | yes | `identity.remove` | → the `EnvInfo`; `bad_request` for `yours`, `in_use` (409) while a mate uses it |
| `POST /api/v1/identities/{name}/secret` | yes | `identity.set_secret` | `{"secret","value"}` → the `EnvInfo`; the value never comes out |
| `GET /api/v1/identities/{name}/ssh-key` | yes | `identity.ssh_key` | → the `EnvInfo` with the public key |
| `POST /api/v1/identities/{name}/ssh-key` | yes | `identity.ssh_key` | `{"action","private_key"}` → the `EnvInfo` |
| `POST /api/v1/identities/copy/begin` | owner | `identity.copy_begin` | → `{"copy_id","public_key"}`; the one-time X25519 key of the target (ADR 0063) |
| `POST /api/v1/identities/{name}/export` | owner | `identity.export` | `{"public_key"}` → `{"bundle"}`, sealed to that key; no SSH private key |
| `POST /api/v1/identities/copy/{copy_id}` | owner | `identity.import` | `{"bundle"}` → the `EnvInfo` with a new SSH public key; `stale` (409) for an expired or used `copy_id` |
| `GET /api/v1/envs` | yes | `env.list` (old name, one release) | → `{"envs":[EnvInfo]}`; an `EnvInfo` is `{"name","kind","parts","secrets":[{"name","set"}],"public_key","new_public_key","used_by"}` (ADR 0061). No response holds a secret value |
| `POST /api/v1/envs` | yes | `env.create` | `{"name","kind","parts","git_name","git_email"}` → the `EnvInfo`; the kind is fixed at creation |
| `GET /api/v1/envs/{name}` | yes | `env.show` | → the `EnvInfo` |
| `POST /api/v1/envs/{name}` | yes | `env.set` | `{"parts","git_name","git_email","secret","value"}` → the `EnvInfo`; the name comes from the path. Secrets are write-only: `value` goes in and never comes out |
| `DELETE /api/v1/envs/{name}` | yes | `env.delete` | → the `EnvInfo`; `in_use` (409) while a mate uses it |
| `POST /api/v1/envs/{name}/unset` | yes | `env.unset` | `{"secret"}` → the `EnvInfo` |
| `GET /api/v1/envs/{name}/ssh-key` | yes | `env.ssh_key` | → the `EnvInfo` with the public key |
| `POST /api/v1/envs/{name}/ssh-key` | yes | `env.ssh_key` | `{"action","private_key"}` (`make`, `rotate`, `confirm` or `import`) → the `EnvInfo`; after `rotate`, `new_public_key` has the new key until `confirm` |
| `POST /api/v1/sessions/{id}/shell` | yes | `shell.focus` | `{"worktree"}` (optional, the body can be empty) → `{"pane","dir","shown"}`; open `pane` with the terminal route |
| `POST /api/v1/sessions/{id}/nvim` | yes | `nvim.toggle` | `{"worktree"}` (optional, the body can be empty) → `{"pane","socket","shown"}`; open `pane` with the terminal route |
| `GET /api/v1/sessions/{id}/review?scope=&worktree=` | yes | `review.open` | → `{"scope","worktrees":[{Worktree,From,Files,Err}],"viewed","draft"}`; each diff line has `Spans` (`[start, end, class]`, see [internal/syntax/](../syntax/AGENTS.md)); an empty `scope` is the last scope of the session, an empty `worktree` is all worktrees |
| `POST /api/v1/sessions/{id}/review/viewed` | yes | `review.viewed` | `{"mark":{Worktree,Path,Blob},"viewed"}` (`mark` required) → `{}` |
| `POST /api/v1/sessions/{id}/review/comments` | yes | `review.comment` | `{"worktree","path","start_line","end_line","code","body","removed"}` → the `ReviewDraft` |
| `POST /api/v1/sessions/{id}/review/send` | yes | `review.send` | `{"note"}` (optional, the body can be empty) → the queued `ReviewDraft`; an empty draft is `bad_request` |
| `POST /api/v1/sessions/{id}/review/hunk` | yes | `review.hunk` | `{"worktree","file","hunk","action"}` (`action` is `stage` or `revert`) → `{}`; when git refuses the patch, it is `failed` with the message of git. The app sends `file` with only the hunk (`hunk` 0), so the body stays below 64 KiB |
| `POST /api/v1/mates/{name}/reset` | yes | `mate.reset` | no body → `{}`; "Start fresh" in the ⋯ menu of the mate header |
| `POST /api/v1/sessions/{id}/fresh` | yes | `mate.fresh` | `{"same_worktree","prompt"}` (optional, the body can be empty) → the new session; "Start fresh" on a mate session |
| `GET /api/v1/disk` | yes | `disk.view`, `subscribe` | → the `DiskView` (tiles, `rows`, `recent`) and `ports` `[{"port","pgid","command","worktree","session"}]`, from the worktrees of one snapshot, because the stream drops `Ports` |
| `POST /api/v1/cleanup/worktree` | owner | `cleanup.worktree` | `{"path","backup"}` (`path` not blank, no other keys) → the `CleanupItem` with its `outcome`. The daemon applies the cleanup rules again. It never removes a `keep` worktree, and it removes a dirty worktree only with `backup` |
| `POST /api/v1/cleanup/run` | owner | `cleanup.run` | → `{"items":[CleanupItem]}`; the Clean up now button. The daemon runs the cleanup plan now, with the same rules as the schedule |
| `POST /api/v1/ports/kill` | owner | `ports.kill` | `{"pgids"}` (not empty) → `{"killed"}`; the daemon stops only process groups that hold a listed port |
| `GET /api/v1/sessions/{id}/browser` | yes | `browser.headless.view` | → `{"live","png","width","height"}`, the last screenshot of the headless tab of the session; `{"live":false}` when the session has no headless tab |
| `POST /api/v1/browser/cookies` | owner | `browser.cookies.import` | `{"file"}` (the text of a Netscape `cookies.txt`, a JSON cookie list or a Playwright `storageState`, no other keys) → `{"imported","total"}`; serve parses the file with `domain.ParseCookieFile`. A file that does not parse is `bad_request` |
| `GET /api/v1/config` | owner | `config.get` | → `{"path","values"}`, the settings of `config.toml` that crew can change |
| `POST /api/v1/config` | owner | `config.set` | `{"key","value"}` (`key` not blank, no other keys; an empty `value` removes the key) → `{"path","values"}` |
| `GET /api/v1/onboarding` | owner | `onboarding.status` | → `{"done","harnesses":{"<harness>":{"installed","file"}},"nvim":{"on_path","configured","config_file","plugin_dir","plugin_found"}}` |
| `POST /api/v1/onboarding/install` | owner | `onboarding.install` | `{"harness"}` (not blank, no other keys) → `{"installed","file","backup","err"}` |
| `POST /api/v1/onboarding/remove` | owner | `onboarding.remove` | `{"harness"}` → the same |
| `POST /api/v1/onboarding/nvim` | owner | `onboarding.nvim` | → the `nvim` object of the status |
| `POST /api/v1/onboarding/finish` | owner | `onboarding.finish` | → `{}` |
| `GET /api/v1/hooks` | owner | `hooks.status` | → `{"missing":[{"env","harness","file","reason"}]}`, the crew hooks that another tool removed (local and custom environments) |
| `POST /api/v1/hooks/fix` | owner | `hooks.fix` | `{"env","harness"}` (`harness` not blank; an empty `env` is `local`) → the same; the setup merge runs again (idempotent, backup first) |
| `GET /api/v1/workspaces/dirs?path=` | owner | `workspace.dirs` | → `{"dirs":[{"Name","Path","Git"}]}`, the folders in `path` (required, absolute) |
| `GET /api/v1/fs/complete?path=` | owner | `fs.complete` | → `{"dir","dirs":[{"Name","Path","Git"}]}`, the folders in `dir` whose names start with the last part of `path` (see [internal/rpc/](../rpc/AGENTS.md)) |
| `GET /api/v1/devices` | owner | `device.list` | → `{"devices":[Device]}`, oldest first |
| `POST /api/v1/devices/{id}/revoke` | owner | `device.revoke` | → `{}`; the streams of that device close with 4401 |
| `POST /api/v1/pair/code` | owner | `pair.code` | `{"name"}` (optional, the body can be empty) → `{"code","expires_at"}`, a one-time code for `POST /api/v1/pair` |

- `POST /api/v1/identities/{name}/{action}` is one route, because Go 1.22 patterns for `copy/{copy_id}`, `{name}/export`, `{name}/secret` and `{name}/ssh-key` conflict. It sends `copy/begin`, `copy/<id>` and `<name>/export` to the owner-only methods. Thus an identity with the name `copy` has no `secret` or `ssh-key` route.
- An "owner" route also needs the owner device. The owner device is the app on the computer that runs crew: the request comes from a loopback address. serve uses the address rule of `pair` (`clientAddr`). Thus a phone through a proxy is not the owner device. Other devices get 403 `forbidden`, and serve does not call the daemon.
- Auth is `Authorization: Bearer <token>`. Before the method runs, serve checks it with `device.check` on the connection of the request. Then it checks it against the set of revoked device IDs.
- `pair` passes the address of the caller as `addr`. This is `RemoteAddr`. If the peer is a loopback or private address (the location of a proxy in front of serve), it is the last `X-Forwarded-For` entry, else `X-Real-IP`. serve ignores a forged header from a direct client.
- Domain structs (`Workspace`, `Session`, ...) encode with their Go field names, as in the socket protocol. The goldens lock them. A `Message` is `rpc.Message`: `{"id","cursor","turn","role","text","tool":{"name","summary","status"},"at"}`. Keep messages by `id` and replace by `id` (see [internal/rpc/](../rpc/AGENTS.md)).
- An "owner" route also needs the owner device: the request comes from a loopback address (the address rule of `pair`, `clientAddr`). Thus a phone through a proxy is not the owner device. Other devices get 403 `forbidden`, and serve does not call the daemon.
- The maximum body size is 64 KiB.
- A route reads the device that made the request with `deviceOf(r)`. The auth check sets it. `push/subscribe` passes its ID to the daemon.
- The daemon sends pushes, not serve. serve only forwards the key and the subscription. See "Web Push" in [internal/daemon/](../daemon/AGENTS.md).

### Adding an endpoint

1. Write the failing test in `server_test.go`: the request, the daemon method and params the fake saw, and a golden for the response.
2. Add one line to `Server.routes()`: a Go 1.22 pattern (`"POST /api/v1/sessions/{id}/send"`) and a `func(r *http.Request, d Daemon) (any, error)`. The routes there are authenticated. Return a value to encode, or an error (an `*rpc.Error` keeps its code). `sessionAction(method, params)` covers this case: "decode a body, add the session id, call one method, pass the result through".
3. Add the method to `allowed` in `server_test.go`, and the endpoint to `authedEndpoints`. Then the token and allowlist tests cover it. Add a row to the table above.

The `/` fallback: `Handler(fallback)` mounts `fallback` at `/`. `Handler(nil)` serves only the API. `cmd/crew/serve.go` passes `Static(Dist())`, the embedded PWA.

## Allowed origins (`[serve] allowed_origins`)

A PWA that is paired with this crew but served from a different origin (ADR 0063) uses the API directly. List each of its origins in `config.toml`:

```toml
[serve]
allowed_origins = ["https://mac.example.ts.net"]
```

- Each entry is an exact origin: a scheme, a host and an optional port. serve ignores default ports. A `*` anywhere, a path or a query makes `crew serve` stop with an `allowed_origins` error before it starts.
- A request under `/api/` from a listed origin gets `Access-Control-Allow-Origin: <origin>` and `Vary: Origin`. There are no cookies, so there is no `Access-Control-Allow-Credentials`. The token goes in `Authorization`.
- A preflight (`OPTIONS`) from a listed origin gets 204 with the methods `GET, POST, DELETE, OPTIONS` and the headers `Authorization, Content-Type`. serve does not call the daemon.
- A request with an `Origin` that is not listed, is not the public URL and is not the host of the request gets 403 `forbidden`. A request with no `Origin` (a CLI or the desktop app) does not change.
- The stream and the terminal routes also accept a listed origin, also when there is no public URL.
- An empty list keeps the old behavior: no CORS headers and no `Origin` check on the HTTP API.
- Tests: `go test ./internal/serve/ ./cmd/crew/ -run 'Origin|ServeFlags'`.

## The embedded web app (`static.go`)

- `Dist()` is `dist/`, embedded with `//go:embed all:dist`. `make web` builds [web/](../../web/AGENTS.md) into it and writes the shell as `app.html`. The committed `index.html` is the placeholder that a `go build` without Node embeds ("run make web"). See [ADR 0048](../../docs/adr/0048-web-toolchain-and-tdd-parity.md).
- `Static(fsys)` serves only `GET` and `HEAD`:
  - `app.html` (else the placeholder) for `/` and for each path with no extension that is not a file (client routes), with `no-cache`.
  - `assets/*` is hashed and `immutable`.
  - Other files (`sw.js`, the manifest, icons) are `no-cache`.
  - `/api` and the paths below it are 404. Behind `Handler`, the JSON `not_found` of the API answers first.
- Tests: `go test ./internal/serve/ -run Static`. After `make web`, `CREW_WEB_BUILT=1` also checks the embedded build.

## Stream (`GET /api/v1/stream`, WebSocket)

- The `Origin` header must be equal to the origin of the public URL. The public URL is `--url`, else `[serve] url`. A URL without a scheme means `https`. serve ignores default ports. A different or missing `Origin`, or no public URL, gets 403 before the upgrade.
- The first client frame must be `{"token":"<device token>"}`, within 5 s (`Config.AuthTimeout`).
  - If the first frame is late, is not JSON or has no token, serve closes the socket with 4400 (`CloseBadHandshake`). The client tries again. A phone that wakes up, or a slow link, must not lose its pairing.
  - serve closes with 4401 only for a token that `device.check` refuses, or for a revoked device.
- Then the server sends `{"state":{"seq","workspaces","tasks","worktrees","sessions","limits","sends","mates"}}`. It sends one `{"diff":{...}}` for each change to these items.
  - A diff sets `seq` and one of `workspace`, `task`, `worktree`, `session`, `limits` (whole list), `sends` (whole list), `mates` (whole board, see [internal/view/](../view/AGENTS.md)), `removed_workspace`, `removed_worktree`, `removed_session`.
  - serve drops events, subagents, review drafts and comments, so `seq` has gaps. Worktrees come without `Ports`.
- Each stream keeps a `view.View` ([internal/view/](../view/AGENTS.md)) of tasks, worktrees, sessions and their last `domain.SessionEventsKept` events. Thus serve sends a session as a `StreamSession`: the Go fields and these fields:
  - `name`: `domain.NameFor` with the PRs of its worktrees.
  - `where`: `domain.WorktreeLabel`, `repo@branch +N`.
  - `banner`: the body of `domain.BannerFor` for its state, also for a muted session. It is empty while the session is running or idle.
  - `since`: `domain.StateSince`, the time when the replayed events last changed its state. It is `null` when the events do not explain the state.
  - `order`: the index of the session in the sidebar of the daemon (see [internal/view/](../view/AGENTS.md)). An ended session has `-1`. The desktop sidebar uses it.

  The phone shows these fields and never calculates them again. If a task or worktree diff changes the derived fields of a different session, a `session` diff with the same `seq` follows it.
- `limits` is `domain.Quotas` of the sessions as `StreamQuota`: the Go fields and `label` (`domain.WindowLabel`), `low` and `stale_at` (`ReportedAt` + `domain.StaleQuotaAfter`).
  - It comes in a diff only when a session change or removal changes it.
  - The client hides windows whose `ResetsAt` (Unix seconds, 0 unknown) has passed. It dims the windows after `stale_at`.
- `{"watch":"<session>","after":<cursor>}` adds the messages of a session through `transcript.watch` on the connection of the stream. `after` is the largest `cursor` that the client has, or 0 for all.
  - The first frame is `{"transcript":{"session","messages":[...]}}` with the messages after the cursor. Then one frame comes for each change.
  - `"reset":true` means that the session moved to a different transcript file. Drop its cursor. The messages that follow start the new file.
  - `"closed":true` means that the session is gone and the watch ended.
  - A new watch of the same session replaces its watch. A stream can have a maximum of 32 watches.
- `{"unwatch":"<session>"}` ends a watch. When the stream closes, all of its watches end.
- `{"visible":bool}` tells if the page is on screen.
  - serve passes it to `device.viewing` on the daemon connection of the stream, so it ends with the stream.
  - While a device is visible, the daemon sends no pushes to it (see "Web Push" in [internal/daemon/](../daemon/AGENTS.md)).
  - There is no reply. serve ignores a failed call. The only result is that the device still gets pushes.
- `{"viewing":{"session":"<id>","front":bool}}` tells which session the desktop app shows, and if the app is in front.
  - serve passes it to `client.viewing` on the daemon connection of the stream, as the Mac app does. The daemon forgets it when the stream closes.
  - There is no reply.
- A failed watch gets `{"error":{"code","message"},"watch":"<session>"}`.
- An unknown client frame gets `{"error":{"code":"bad_request","message"}}`, and the stream stays open.
- Close codes:

  | Code | Meaning | Client |
  |---|---|---|
  | 4401 `CloseUnauthorized` | the daemon refused the token, or the device was revoked | confirms with an authed GET before it forgets the login (see [web/](../../web/AGENTS.md)) |
  | 4400 `CloseBadHandshake` | the first frame was late, not JSON, or had no token | retries |
  | 4502 `CloseBuildMismatch` | the daemon runs a different build (`version_mismatch`); the reason tells the two builds | stops and shows Build mismatch with Reconnect |
  | 1013 | the daemon went away, or could not be reached to check the token | retries |
  | 1001 | serve is stopping (also while a stream waits for its token) | retries |
  | 1011 | a write failed | retries |
  | 1000 | the client left | none |
- Revocation:
  - A stream subscribes before it runs `device.check` on the same connection. Thus the loop of the daemon puts them in order. A revoke before the check makes the check fail. A revoke after the check gets to the subscription of the stream as a `revoked_device` diff.
  - That diff, or the diff on the `Start` connection, cancels all open streams of that device (4401 immediately). It also records the ID, so REST checks that answered immediately before it still fail.
  - The stream does not depend on the `Start` connection, which can be connecting again after a daemon restart.
  - The stream reads its subscription in its own goroutine and queues the diffs for the writer. Thus a phone that stops reading (a write blocked for up to 10 s) still sees its revocation immediately. The canceled write closes the socket, with 4401 if the transport is still open.

## Terminal (`GET /api/v1/terminal/{pane}`, WebSocket)

The xterm.js tabs of the app show a tmux pane through this route (ADR 0057). `{pane}` is a tmux pane id, for example `%5` (URL-encoded `%255`). Get the pane of the agent from `session.Pane`, the shell from `POST /sessions/{id}/shell` and nvim from `POST /sessions/{id}/nvim`.

- The `Origin` check and the close codes 4400, 4401, 1001 and 1000 are the same as for the stream. A revoked device closes with 4401.
- The first client frame is `{"token","cols","rows"}`. A size below 1 gives 80x24.
- serve calls `client.native` with the size. This makes a native tmux session on the `crew` server, as for the Mac app. Then serve runs its `argv` (`tmux -C attach-session`) through `Config.Control`. serve does not import `os/exec`, so `cmd/crew` gives `Control` (`startControl`). Without `Control`, the route closes with 1013.
- serve sends these control-mode commands: `refresh-client -C <window>:<cols>x<rows>`, `display-message` (window, size and cursor) and `capture-pane -p -e`. It matches the replies by the `%begin` blocks that have flag 1.
- Server frames:
  - First, one text frame `{"screen":{"pane","window","cols","rows","cursor":{"x","y","visible"},"data"}}`. `data` clears the screen, draws the captured lines and moves the cursor. Write it to xterm.js as it is.
  - Then one binary frame for each `%output` or `%extended-output` of the pane: the raw bytes. serve drops output that comes before the capture.
  - `{"error":{"code","message"}}` for a bad client frame. The socket stays open.
- Client frames after the first:
  - A binary frame is keys. serve sends them with `send-keys -H` in chunks of 256 bytes.
  - `{"size":{"cols","rows"}}` (both 1 or more) sizes the window of the pane.
- Close codes: 4404 `CloseNoPane` when the pane is not in the native session or is gone; 1013 when the daemon or tmux cannot start, or tmux control mode ends.
- Tests: `go test ./internal/serve -run Terminal` (a fake control process in `terminal_fake_test.go`) and `go test -tags integration ./internal/serve -run Terminal` (a real tmux server on its own socket).
