# internal/rpc

This package holds the protocol types (`protocol.go`) and the client. `crew serve`, `crew rpc`, the hook, the CLI and nvim use them. See [ADR 0005](../../docs/adr/0005-daemon-rpc.md). The daemon side is in [internal/daemon/](../daemon/AGENTS.md).

## Protocol

The transport is a Unix socket at `$CREW_HOME/crew.sock`. It carries one JSON object per line, at most 16 MiB. Each message has `"v":1`.

```
→ {"v":1,"id":1,"method":"status"}
← {"v":1,"id":1,"result":{"pid":42,"started_at":"…","sessions":2,"worktrees":3}}
→ {"v":1,"id":2,"method":"subscribe"}
← {"v":1,"id":2,"result":{"seq":17,"workspaces":[…],"tasks":[…],"worktrees":[…],"sessions":[…]}}
← {"v":1,"id":2,"diff":{"seq":18,"session":{…}}}
→ {"v":2,"id":3,"method":"status"}
← {"v":1,"id":3,"error":{"code":"unsupported_version","message":"this daemon speaks protocol v1"}}
```

- The client selects `id`. Responses and the diffs of a subscription contain the same `id`. A connection can have several requests in flight.
- `subscribe` answers with the full `State` at `seq`. Then it sends one `diff` for each change, starting at `seq+1`.
  - A diff sets exactly one of `workspace`, `task`, `worktree`, `session`, and replaces that entity by key.
  - The one exception is a hook. Its diff sets `session` and `event` together. The daemon appends `event` to the events of its session.
  - List diffs set `sends` (the queued `session.send` texts) to the whole list.
  - `State.events` holds the last 20 events of each session. Domain structs encode with their Go field names.
- A diff can also set `removed_workspace` (a root), `removed_worktree` (an ID) or `removed_session` (an ID). The client then drops that entity. For a session, it also drops the events.
  - `revoked_device` (an ID) tells that a paired device was revoked. Clients without devices ignore it.
  - `project` replaces a registered project by `Root`. `removed_project` (a root) drops one. `State.projects` lists all projects.
- A subagent change is a separate diff that sets `subagent`. It replaces the subagent with the same `SessionID` and `ID`. `State.subagents` holds the subagents of each session (a maximum of 30 each, in memory only). See [ADR 0019](../../docs/adr/0019-subagent-tree.md).
- A new method or a new optional field keeps `v:1`. If you remove a field or change its meaning, increment `v`.

## Build handshake

Each RPC request and response contains the build (`version.String()`). The daemon refuses a request from a different build. A client refuses a daemon that gives no build. Both use `version_mismatch`, which tells which side to restart (the older one). `status`, `hook` and `statusline` answer all builds. Thus `crew daemon stop` always gets to a stale daemon. See [ADR 0039](../../docs/adr/0039-dev-loop-and-build-handshake.md).

## Methods

- `hook` carries one harness hook: `{"harness","event","pane","at","payload"}`. `payload` is the stdin JSON of the hook.
  - The daemon maps `pane` to the session whose `Pane` matches (`domain.SessionOnPane`). It maps the name to a harness event (`domain.HookEvent`), then applies it. It ignores unknown panes and names.
  - The result is a `HookReply`. The hook prints its optional `output` for the harness.
- `statusline` carries one status-line update: `{"pane","report"}`. The daemon applies it with `Session.Report` to the session on that pane.
- `session.launch` (`{"harness","dir","model","effort","name","prompt"}` → `Session`) opens a pane through the harness adapter and adds an `idle` session on it.
  - A non-empty `name` also creates a text task with that name, so the session and its banners show it.
  - It is available only with `WithHarnesses`. If the pane cannot be created, it fails with `launch_failed`.
- `session.switch` (`{"session_id","kind","value"}` → `Session`, kind `model` or `effort`) queues a model or effort switch. It sends the switch when the session is idle, done or waiting. See [ADR 0018](../../docs/adr/0018-model-effort-switching.md), and [ADR 0034](../../docs/adr/0034-codex-model-picker-switching.md) for Codex. It also needs `WithHarnesses`.
- `session.send` (`{"session","text"}` → `{"id","queued"}`) queues text for the pane of the session.
  - It pastes the text when the session is idle, done or waiting, one send for each free turn. `queued` is true when the text had to wait.
  - Queued sends are in `State.sends`. Each change is a diff that sets `sends` to the whole list.
  - `session.unsend` (`{"session","id"}`) drops a queued send. `session.interrupt` (`{"session"}`) sends Escape.
  - Empty text is `bad_request`. An ended session is `failed`. These methods need `WithHarnesses`.
- `session.new` (`{"workspace","work_item","harness","model","effort","prompt"}` → `Session`) starts a session.
  - It parses the work item and plans the dir and worktree in `domain`. Then it runs git, the setup recipe and tmux on the connection goroutine. It commits the task, worktree, session and last-used workspace.
  - If the launch is successful, the daemon queues a non-blank `prompt` as a `session.send` text. It pastes it as the first turn of the session. A failed launch queues nothing. See [internal/daemon/](../daemon/AGENTS.md).
- `session.end` (`{"id"}` → `Session`) kills the pane and ends the session: idle and `Ended`. If the session has no worktree, the daemon forgets it immediately.
- With a terminal host and an open client layout, `session.focus` also swaps the pane of the session into the main slot and focuses it.
- These session methods need `WithHarnesses`. `session.new` also needs `WithSessions`.
- `session.prompt` (`{"session"}` → `{"id","text","choices":[{"id","label"}],"raw"}`, `id` a hash of the dialog) captures the pane of the session on the connection goroutine. It returns the parsed permission dialog.
  - If the session is in `permission` but the dialog is not recognized, it returns `{"text":"","choices":[],"raw":"<the last 40 visible lines>"}`.
  - If no dialog shows, it returns `not_found`.
- `session.answer` (`{"session","choice","prompt"}`) reads the dialog again. It presses the keys of that choice only while the session is still `permission`.
  - If `prompt` is given, it must be equal to the `id` of the dialog that shows. If not, the answer is `stale`.
  - If the session is not in `permission`, it answers `stale` and sends nothing.
  - A choice that the dialog does not have is `bad_request`.
  - `session.prompt` and `session.answer` need `WithHarnesses`.
- `session.resolve` (`{"workspace","work_item"}` → `{"source","ref","title","worktree","workspace"}`) tells what `session.new` would start, but does not start it.
  - It checks the item with `domain.CheckWorkItem` (`bad_request`).
  - It finds a PR title through the title resolvers, off the event loop. If that fails, it returns `not_found`.
  - It names the worktree as `session.new` does. It registers nothing.
- `session.options` (`{}` → `{"harnesses":[{"harness","name","tag","models","efforts","model","effort","default_model","default_effort"}],"home"}`) tells what a new-session form offers. `home` is the home folder of the server, so a client can read a typed `~/` or relative path.
  - `default_model` and `default_effort` tell what "default" means for the harness: the value in the config of the harness (`~/.claude/settings.json` `model`/`effortLevel`, `~/.codex/config.toml` `model`/`model_reasoning_effort`), else the built-in default of `domain.HarnessSpec` (`domain.ResolveDefault`). They are absent when neither is known (omp). Clients show `default (<value>)` (`domain.DefaultLabel`).
  - There is one entry for each registered harness, in `domain.Harnesses()` order. Each entry has its `domain.Spec` models and efforts.
  - `model` and `effort` come from `[defaults.<harness>]` in `$CREW_HOME/config.toml` (`daemon.LoadStartDefaults`). The daemon reads them at start and again after each `config.set`. They are empty when unset.
  - The new-session sheet of the Mac app uses it, because the app cannot read the config of a remote server.
- `config.get` (`{}` → `{"path","values":{"<table>.<key>":"<value>"}}`) and `config.set` (`{"key","value"}` → the same) work on the settings in `$CREW_HOME/config.toml` that clients can change.
  - `domain.ConfigKeys` lists them: `fallback.threshold`, `push.away_after`, `defaults.<harness>.model`/`effort`, `theme.<colour>`.
  - Values are strings. Unset keys are absent.
  - `config.set` validates with `domain.ConfigLiteral` (else `bad_request`). An empty value removes the key. See [internal/daemon/](../daemon/AGENTS.md#config).
  - Without `WithConfig`, both answer `unavailable`.
- `automation.list` (`{"repo"}` → `{"automations","problems"}`) reads the `[[automation]]` tables of `config.toml` and of `<repo>/.crew.toml` on the connection goroutine. See [ADR 0050](../../docs/adr/0050-automations.md).
  - With `repo`, a repo automation replaces the global one with the same name (`domain.MergeAutomations`). Without `repo`, the list has the global automations, then the automations of each registered repo.
  - An automation that `domain.ValidateAutomation` refuses is not in the list. Its error is in `problems`, with the file path.
  - `automation.show` (`{"name","repo"}` → an automation) uses the same list. An unknown name is `not_found`.
- `automation.run` (`{"name","context","work_item","repo"}` or `{"rerun":"<run id>"}` → `{"run","session"}`) starts one run (`domain.PlanAutomationRun`).
  - The repo is `repo`, else the folder of the `.crew.toml` of the automation, else the last used workspace.
  - `new-worktree` goes through `session.new`. `workspace` and `worktree:<path>` open a pane in that folder, as `session.launch` does. `session = "reuse"` sends the prompt to the live session of the last run.
  - A `precheck` runs as `sh -c` in the repo (or the target folder) first, with a 2 min limit. A non-zero exit records the run as `skipped` and starts nothing. A failed start records `failed`.
  - `rerun` repeats the name, context, work item and repo of a recorded run.
- `automation.trust` (`{"name","repo"}` → the automation) approves a repo automation with a `schedule`, `on` or `precheck`. The daemon stores a hash of the definition (`domain.AutomationHash`) in the `automation_trust` table. A changed definition is not trusted. The list sets `trusted`. The schedule and events start only automations that are enabled and trusted (`domain.AutomationCanRunAlone`). Global automations need no approval.
- `automation.save` (`{"automation"}` → the saved automation) validates it and writes it as an `[[automation]]` table in `config.toml` (`domain.SetAutomationBlock`). It replaces the table with the same `name`, else it appends one. It makes the same backup and atomic write as `config.set`. It never writes a repo `.crew.toml`.
- `automation.runs` (`{"name","limit"}` → `{"runs"}`) lists recorded runs, newest first. An empty `name` lists all. Runs are in the `automation_runs` table.
- `mate.list` (`{}` → `{"mates","problems"}`) reads the `[[mate]]` tables of `config.toml` on the connection goroutine. See [ADR 0053](../../docs/adr/0053-mates.md).
  - A mate that `domain.CheckMates` refuses is not in the list. Its error is in `problems`, with the file path. The other mates still load.
  - An unknown key in a `[[mate]]` table is also a problem.
  - `mate.show` (`{"name"}` → a mate) uses the same list. An unknown name is `not_found`.
  - `mate.set` (`{"mate"}` → the saved mate) validates the mate against the registered workspaces (`bad_request`). It writes it as a `[[mate]]` table (`domain.SetMateBlock`) with the backup and the atomic write of `config.set`. It replaces the table with the same `name`, else it appends one.
  - `mate.remove` (`{"name"}` → the removed mate) deletes the table (`domain.RemoveMateBlock`) with the same backup. An unknown name is `not_found`.
  - All four answer `unavailable` without `WithConfig`. No result holds a token.
  - `mate.set_tokens` (`{"name","bot_token","app_token"}` → `{"name","has_bot_token","has_app_token"}`) stores the Slack tokens of a mate in files with mode 600 under `$CREW_HOME/secrets/`. The bot token starts with `xoxb-` and the app token with `xapp-`. A wrong prefix is `bad_request`, and the error never holds the value. An unknown mate is `not_found`. Without a secret store, it is `unavailable`.
  - `mate.clear_tokens` (`{"name"}` → the same status) removes both files. `mate.remove` also removes them.
  - `mate.claim` (`{"name"}` → `{"name","code","expires_at"}`) makes a one-time owner code for the mate. It is good for 10 minutes. A new claim replaces the old code. An unknown mate is `not_found`. Without the Slack worker, it is `unavailable`.
  - A mate without Slack tokens has the state `ready`. Slack is an optional connector (see [ADR 0056](../../docs/adr/0056-local-mates.md)). A mate also has the optional `avatar` (an id of a built-in face) and `color` (`#rrggbb`). It also has `tone` (`{"terse","cautious","formal"}`, each 1 to 5; 0 is the middle step) and `no_memory`. In `config.toml` this is `tone = { terse = 2 }` and `no_memory = true`. `mate.list` also returns `tones`: for each axis the `key`, the `low` and `high` labels and the five `steps`, the sentence that each step adds to the prompt (the middle step adds none).
  - `mate.new` (`{"name","repo","prompt"}` → the session) starts a new conversation with a mate. The session is in its own worktree in `repo`, or in the first repo of the mate. It gets `domain.MateSystemPrompt` (the mate prompt, then the tone sentences, then the memory file unless `no_memory`) as its system prompt, and the model and effort of the mate. `session.mate` has the mate name and `Local: true`. The gate does not stop a local session, and its tokens do not count to the Slack budget. An unknown mate is `not_found`.
  - `mate.memory` (`{"name"}` → `{"name","path","text","limit"}`) reads `$CREW_HOME/mates/<name>/memory.md`. `mate.set_memory` (`{"name","text"}` → the same) writes it. An empty text clears it. A text over 8192 bytes is `bad_request`.
  - `mate.fresh` (`{"session","same_worktree","prompt"}` → the new session) is "Start fresh". The session must be a mate session (else `bad_request`; an unknown session is `not_found`). If it is live, the daemon first sends it `domain.MateHandoffPrompt` with `session.send`: it asks the mate to write a short handoff to its memory file. Then it starts a new conversation of the same mate like `mate.new`. With `same_worktree`, the new session runs in the directory of the old one and gets no new worktree. The old session stays until the user ends it.
  - With the Slack worker, `mate.list` also has `states`: `{"name","state","error"}` for each mate. `state` is `connecting`, `connected`, `error`, `paused` (not enabled) or `no_tokens`. `error` has the Slack error code, never a token.
  - A client can set or clear a token. No method returns one.
  - `mate.pause` and `mate.resume` (`{"name"}` → the saved mate) write `enabled = false` or remove it in the `[[mate]]` table, with the backup of `config.set`. A paused mate has no Slack connection. An unknown mate is `not_found`.
  - `mate.stop_all` (`{"stop"}` → the limits) is the kill switch. `true` writes `stop = true` in `[mates]` of `config.toml`. `false` removes the key. The file is the only record of the stop, so a restart keeps it and a hand edit has the same effect. Each new turn reads the file, so the stop applies to the next turn of all mates.
  - `mate.setup` (`{"name"}` → `{"manifest","url"}`) gives the Slack app manifest of the mate and the api.slack.com link that makes the app from it. An unknown mate is `not_found`.
- Environments ([ADR 0061](../../docs/adr/0061-environments-for-mates.md)). An answer is `EnvInfo`: `{"name","kind","parts","secrets":[{"name","set"}],"public_key","new_public_key","key_created","git_name","git_email","used_by","local"}`. `new_public_key` is there while a new key waits for `confirm`. `key_created` is the RFC 3339 time of the key file. `git_name` and `git_email` are the git identity of a custom environment (not secret). `codex_login` is true when a custom environment with the `codex` part has a Codex `auth.json` (`crew env login <env> --harness codex`). `local` is only for a local environment: `{"git_name","git_email","ssh_agent","ssh_keys","github","github_user","claude","codex","pi"}`. These are facts of the daemon box, as booleans and labels only. The daemon finds them with `app.LocalProbe` on request and keeps them for 30 s (`WithLocalProbe`). No answer holds a secret value. A secret value only goes in (`env.set`).
  - ADR 0063 renames these methods. The `env.*` names stay as aliases for one release.
    - `environment.list` (`{}` → `{"machine":{"id","name"},"identities":[EnvInfo],"found":EnvLocal}`). The first identity is always `yours`. `found` is the logins that crew found on the machine. No answer has a secret value.
    - `identity.set` (`{"name","kind","parts","git_name","git_email"}`) makes the identity (the default kind is `custom`, thus `separate`), or changes the parts and the git identity of an identity that exists.
    - `identity.remove` (`{"name"}`) is `env.delete`. It refuses `yours` (and `local`) with `bad_request`.
    - `identity.set_secret` (`{"name","secret","value"}`) is `env.set` with a secret. `identity.ssh_key` is `env.ssh_key`.
    - The sealed copy of a separate identity (owner only in serve). `identity.copy_begin` (`{}` → `{"copy_id","public_key"}`) makes a one-time X25519 key on the target and keeps the private key in memory for 5 minutes (`domain.CopyKeys`). `identity.export` (`{"name","public_key"}` → `{"bundle"}`) seals the git name and email, the parts, the extra names and each secret value to that key (`domain.SealIdentityBundle`: X25519, HKDF-SHA256, AES-GCM, base64). It refuses `yours`. The bundle never has the SSH private key. `identity.import` (`{"copy_id","bundle"}` → the `EnvInfo`) uses the key one time, opens the bundle, saves the identity and its secrets and makes a new SSH key. An expired or used `copy_id` is `stale`. A bundle for a different key is `bad_request`. An identity that exists is `in_use`. No answer, log line or error has a secret value.
    - `mate.set` takes `"environment":{"machine_id","identity_id"}` next to `mate`. A `machine_id` that is not the ID of this daemon gets `wrong_machine`.
  - `env.list` (`{}` → `{"envs"}`) gives each `[[env]]` table. It also gives `local` when the file has no `local` table. `used_by` lists the mates of the environment (for `local`, also the mates with no `env`).
  - `env.show` (`{"name"}`). An unknown name is `not_found`.
  - `env.create` (`{"name","kind","parts","git_name","git_email"}`). The kind is fixed at creation: a name that exists is `bad_request`. `local` must be of kind `local`. A local environment has no parts and no git identity.
  - `env.set` (`{"name","parts","git_name","git_email","secret","value"}`) changes the parts or the git identity of a custom environment, or stores one secret. A local environment takes only extra secret variables (else `bad_request`). An empty `value` is `bad_request`. A name that `domain.ValidateExtraVarName` refuses is `bad_request`, and the error never holds the value.
  - `env.unset` (`{"name","secret"}`) removes one secret.
  - `env.delete` (`{"name"}`) is `in_use` while a mate uses the environment.
  - `env.ssh_key` (`{"name","action","private_key"}`). `action` is empty (show), `make`, `rotate`, `confirm`, `cancel` or `import`. `cancel` deletes the new key of a `rotate` and keeps the old key. With no new key, it is `failed`. `rotate` keeps the old key in `public_key` and gives the new key in `new_public_key` until `confirm`. A local environment has no key (`bad_request`).
  - A change applies at the next start or resume of a mate. The daemon does not restart a running agent. Without `WithEnvironments` and `WithConfig`, all answer `unavailable`.
- The `State` of `subscribe` has `mates` (`{"stopped","mates":[{"name","state","error","guard"}]}`, sorted by name) and `mate_threads` (`[{"mate","team","channel","thread_ts","session_id","url"}]`). `url` opens the thread in Slack, and it is empty when a part is not known. A diff sets `mates` with the full board when it changes, and `mate_thread` when a thread link changes. The Slack worker makes the board after each sync and each state change of a mate. `guard` comes from `domain.MateGuard`.
- `approval.list` (`{}` → `[Approval]`, oldest first) gives the pending approvals of mate sessions that did not expire. An `Approval` is `{"ID","SessionID","Mate","Requester","Channel","ThreadTS","Message","Action":{"Kind","Tool","Input"},"At","State"}`.
  - `approval.decide` (`{"id","approve"}` → the decided `Approval`) decides one approval as the owner. A caller on the socket (the CLI, `serve`, the Mac app) has access to the server, thus it is the owner. An unknown ID is `not_found`. An approval that is decided or expired is `stale`.
- Other methods: `status`, `subscribe`, `session.mute` (`{"id","muted"}`), `session.focus` (`{"id"}`), `session.rename` (`{"id","name"}`), `session.unpin` (`{"id"}`), `ports.kill`, `disk.view`, `cleanup.worktree`, `review.open`, `review.viewed`, `review.comment`, `review.send`, `review.hunk`, `shell.toggle`, `shell.focus`, `nvim.toggle`, `nvim.open`, `onboarding.status`, `onboarding.install`, `onboarding.remove`, `onboarding.finish` and `debug.seed`.
  - `onboarding.remove` (`{"harness"}`) copies the hook file to `<file>.crew-removed-<time>.bak`, then removes the hooks. `onboarding.install` puts them back.
- Workspace and project methods:
  - `workspace.add` (`{"path": abs}` → `Workspace`).
  - `workspace.list` (→ `{"workspaces": [...], "last_used": root}`).
  - `workspace.remove` (`{"root": …}`).
  - `workspace.dirs` (`{"path": abs}` → `{"dirs": [Child]}`): the subfolders of the folder, for the path completion of the dialog. It registers nothing.
  - `fs.complete` (`{"path"}` → `{"dir","dirs": [Child]}`): the completion of a typed folder path, for the workspace fields of the app. `~` and `~/` are the HOME of the daemon, and a relative path starts in HOME. An absolute path that the user types is also listed, because only the owner device can call it. It gives only folders (a symlink to a folder counts) with their names, paths and git marker, never file contents. It gives dot folders only when the last part starts with `.`, sorts by name without case and gives a maximum of `FSCompleteLimit` (50). A folder that it cannot read gives no folders, not an error. It changes nothing.
  - `project.add` (`{"path": abs, "name", "setup"}` → `Project`). It is `bad_request` unless the path discovers one or more repos. It also adds the workspace.
  - `project.list` (→ `{"projects": [...]}`).
  - `project.remove` (`{"root"}`). The workspace stays.
  - `worktree.assign` (`{"id", "session"}`). An empty session unassigns.
  - These methods are available only when the daemon is built with `WithWorkspaces`. If not, they answer `unknown_method`. Their params are in [internal/daemon/](../daemon/AGENTS.md).
- Review methods are available only with `WithReview`:
  - `review.open` (`{"session","scope","worktree"}` → `{"scope","worktrees":[{Worktree,From,Files,Err}],"viewed":[marks]}`). An empty `worktree` means all worktrees of the session. An empty `scope` means the last scope that the session opened. `From` is the commit where the diff starts. `review.open` also returns the `draft` of the session.
  - `review.viewed` (`{"mark":{Worktree,Path,Blob},"viewed"}`).
  - `review.send` (`{"session","note"}` → `ReviewDraft`) queues the draft and sends it when the session is idle, done or waiting. The draft keeps a non-empty `note` and pastes it after the comments under `Overall:`. An empty draft is `bad_request`.
  - `review.hunk` (`{"session","worktree","file","hunk","action"}`, action `stage` or `revert`) also needs `WithHunks`. If git refuses the patch, it is `failed`.
- `client.open` `{"command":[…],"env":{…}}` returns `{"slot","attach"}`.
  - `slot` is the client window: the TUI pane on the left runs `command`, and the main slot is on the right. The first call creates the window. Later calls use it again while it exists.
  - `attach` is the argv that attaches a terminal to it.
- `client.focus_main` makes the main slot of that window the active pane.
- The `client.*` methods run tmux on the connection goroutine, never on the loop. Without a terminal host, they return `unavailable`. A tmux failure returns `failed`.
- `client.native` `{"cols","rows"}` returns `{"argv","session","panes"}` for the Mac app (ADR 0049).
  - `argv` attaches a tmux control-mode client (`tmux -L <socket> -f <conf> -C attach-session -t =<session>`) to its own session.
  - `panes` lists each parked agent or shell pane as `{"pane","window","session_id","cols","rows"}`. It also gives the mode flags that a new client does not see in the stream (`mouse_any`, `mouse_button`, `mouse_standard`, `mouse_sgr`, `alternate`, `cursor_visible`, `cursor_keys`).
  - `session_id` is the crew session that owns the pane. It is empty for a shell.
  - A size less than 1 is `bad_request`. No terminal host is `unavailable`.
  - Tests: `go test -tags integration ./internal/adapters/tmux/ ./internal/daemon/ -run Native`.
- Pairing (ADR 0046):
  - `pair.code` (`{"name"}` optional → `{"code","expires_at"}`).
  - `pair.redeem` (`{"code","name","addr"}` → `{"device","token"}`). `addr` is the address of the caller. It is required, for the failed-try limits.
  - `device.check` (`{"token"}` → `{"device"}`). It also records the last-seen time.
  - `device.list` (→ `{"devices":[…]}`, oldest first) and `device.revoke` (`{"id"}`).
  - A device is `{"id","name","created_at","last_seen"}`. Its token hash never leaves the daemon. A revocation is a diff with only `revoked_device` (an ID) set.
  - `device.viewing` (`{"device","visible"}` → `{}`) records if the app of that device is on screen, while the calling connection stays open. An unknown device is `not_found`. `serve` sends it on the connection of the stream.
  - `client.viewing` (`{"session","front"}` → `{}`) records the session that a native client shows, and if the client is in front, while the calling connection stays open. See "Web Push" in [internal/daemon/](../daemon/AGENTS.md).
- Browser ([ADR 0051](../../docs/adr/0051-browser-in-mac-app.md)):
  - `browser.attach` (`{}` → `{"attached":true}`) makes the calling connection the browser. The Mac app sends it. A new attach replaces the old one. The attach ends when its connection closes.
  - After the result, the daemon pushes each call on the same `id` as a response with `browser`: `{"call","session","command","args"}`.
  - The app answers with `browser.reply` (`{"call","result","error"}` → `{}`) on the same connection. A call that does not wait for this connection is `not_found`.
  - `browser.command` (`{"session","pane","browser","command","args","timeout_ms"}` → the `result` of the app) runs one command. With no `session`, the daemon uses the session on `pane`.
  - `browser` is `any`, `app`, `mac` or `headless`. `app` and `mac` use only the attached app. With no `browser`, the daemon uses the choice of the automation of the session. A different value is `bad_request`.
  - With no attached app, it is `unavailable` with the message `no browser: the macOS app is not connected`. If the app disconnects first, it is also `unavailable`.
  - An `error` from the app is `failed` with that message. No reply in `timeout_ms` (default 30 s, a maximum of 10 min) is `failed`.
  - An unknown command, or no session and no known pane, is `bad_request`.
  - With no attached app and `[browser] fallback = "headless"`, or for a session of an automation with `browser = "headless"`, the daemon runs the command in a headless Chromium on the server ([ADR 0054](../../docs/adr/0054-headless-browser-fallback.md)). The result has the same shape. A full `max_headless` limit, or a Chromium that does not start, is `unavailable`.
  - `browser.cookies.import` (`{"cookies":[{"name","value","domain","path","expires","secure","httpOnly","sameSite"}]}` → `{"imported","total"}`) keeps the cookies for the headless browser. No cookies, or a cookie with no name or domain, is `bad_request`.
  - `browser.headless.view` (`{"session"}` → `{"live","png","width","height"}`) gives a PNG screenshot (base64) of the headless tab of the session. It never starts a tab. When the session has no headless tab, the result is `{"live":false}`. No session is `bad_request`. The Mac app polls it to show the headless tab read-only.
- Web Push (ADR 0046):
  - `push.key` (→ `{"public_key"}`).
  - `push.subscribe` (`{"device","endpoint","keys":{"p256dh","auth"}}` → `{}`). An unknown device is `not_found`. An endpoint that is not https, or keys that are not from a browser, are `bad_request`.
  - `push.unsubscribe` (`{"device"}` → `{}`). An unknown device is `not_found`.
  - On a daemon built without `WithPush`, all three answer `unknown_method`.
- Transcripts (ADR 0046): `transcript.page` (`{"session","before","limit"}` → `{"messages","before"}`) reads one page of the transcript of the session. The page ends before the byte offset `before` (0 or absent: the newest page).
  - The default `limit` is 50, and the maximum is 500. A page can hold some more messages when one transcript line gives several messages, because a line is never split across pages.
  - The `before` of the response is the start of the line of its oldest message. Pass it back to get the page before it. 0 means that there is nothing older.
  - A session with no transcript yet gives an empty page. An unknown session is `not_found`. A `before` that is not a line start, or is after the end, is `bad_request`.
- `transcript.watch` (`{"session","after"}`) watches a transcript. `after` is the largest `cursor` that the client has, or 0 for the whole file.
  - It answers `{"messages"}` with the messages after `after`. Then it streams responses with the same `id` that set `transcript`:
    - `{"messages"}` for new messages.
    - `{"reset":true,"messages"}` when the session moved to a different transcript file (a resume or Claude's `/clear`), or when the file shrank and is read again from its start. Old cursors belong to the old file. The messages that follow start at the beginning of the new file.
    - `{"closed":true}` when the session was removed. This ends the watch.
  - The result and each event carry a maximum of 500 messages. More messages follow as events.
  - `transcript.unwatch` (`{"watch"}`, the id of the `transcript.watch` request) ends a watch. When the connection closes, all of its watches end.
- A message is `{"id","cursor","turn","role","text","tool":{"name","summary","status"},"at"}`.
  - `role` is `user`, `assistant`, `tool` or `system`. Tool `status` is `running`, `done` or `failed`.
  - `cursor` is the offset immediately after the source line of the message.
  - Clients keep messages by `id` and **replace by `id`**. A tool call comes first as `running`. When its result is written, the same `id` comes again with its final status and text and the original `cursor` of the call. Thus it can arrive after messages with larger cursors.
  - Paging pairs a call with a result on a newer page (up to 1 MiB ahead), so pages never repeat an `id`. A result whose call is on an older page is not a separate message.
  - `turn` can be empty for messages before the user message of their turn, when the page starts in the middle of a turn.
- Tabs of a project worktree: `tab.new`, `tab.show`, `tab.step` and `tab.close` (`rpc.TabParams` → `domain.Tab`). See [internal/daemon/](../daemon/AGENTS.md#tabs). `State.shell_tabs` and `State.active_tabs` (worktree → tab ID) carry them to late subscribers. A diff sets `shell_tab`, `removed_shell_tab` (an ID) or `active_tab` (`{"worktree","tab"}`).
- `debug.seed` `{"count":N}` adds N fake sessions for manual tests. `crew debug seed N` calls it.
- Error codes:
  - `unsupported_version`: a missing or different `v`.
  - `unknown_method`.
  - `bad_request`: not JSON, bad params, or a path that is not a directory. `id` is 0 when the request is not JSON.
  - `not_found`: removal of an unknown workspace, or mute, focus or end of an unknown session.
  - `unavailable` and `failed` (above), `launch_failed`, `version_mismatch`.
  - `unauthorized`: a wrong or expired pairing code, or an unknown or revoked device token.
  - `rate_limited`: too many failed pairing tries.

## Client

- `rpc.Dial(path)` connects. `rpc.Connect(ctx, path, start)` calls `start` one time if nothing listens, and tries again for `rpc.StartTimeout` (2 s).
- `Client.Call(ctx, method, params, out)` is the generic call. It returns `*rpc.Error` for daemon errors. `Status` and `Subscribe` wrap it.
- `TranscriptPage(ctx, session, before, limit)` returns a `TranscriptPage`.
- `WatchTranscript(ctx, session, after)` returns a `TranscriptWatch` with the initial `Messages` and an `Events` channel of `TranscriptEvent`. The channel closes after a `Closed` event, when the connection ends, or when `ctx` is cancelled. A cancel also sends `transcript.unwatch`.
- `Subscribe` returns the `State` and a `Diffs` channel that closes when the connection ends. Its diffs share the reader of the connection. Thus a slow consumer must use its own `Client`.
- `rpc` cannot exec, so the caller supplies `start` (`cmd/crew` starts `crew daemon`).
