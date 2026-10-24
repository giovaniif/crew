# ADR 0063: Environments are machine plus identity

Status: accepted, 2026-10-23. Tracking issue: "Environments are machine plus identity". It amends [ADR 0061](0061-environments-for-mates.md), [ADR 0057](0057-tauri-apps.md) (the server list of the desktop app) and [ADR 0046](0046-remote-app.md) (pairing). The frames are 11 and 12 in [docs/design/mates/](../design/mates/README.md#environments-are-machine-plus-identity-frames-11-and-12).

## Context

- ADR 0061 makes an environment a named profile on the daemon box. Its kind is `local` or `custom`.
- The desktop app keeps a separate list of servers (`desktop/src/servers.rs`, `desktop/src/hub.rs`, `servers.json`). The kinds are `local`, `url` and `ssh`. The sidebar chip "This computer ▾" switches between them. Each server opens in its own window. Settings › Servers manages the list.
- Thus a user must know two things: the machine (from the switcher) and the environment (from the picker). The two lists do not show together.
- Each machine runs its own daemon and its own `crew serve`. A daemon knows only its own mates, environments and secrets.
- ADR 0061 says that a client can set a secret but cannot read one.
- A page that a remote `crew serve` sends gets no IPC (desktop `ipc.rs`). Only the page of the local `crew serve` gets the server commands.

The owner approved frames 11 and 12 on 2026-10-23.

## Decision

### The model

- A **machine** is This Mac (the computer that runs the app) or a server that the app connects to over SSH. Each machine runs its own crew.
- An **identity** is on one machine. Each machine has one identity of kind `yours` ("Your accounts"). It is always there and you cannot remove it. It uses the logins that crew found on the machine, and crew does not change them. It can hold extra secret variables. All other identities have the kind `separate`.
- An **environment** is one machine plus one identity. The UI name is "machine · identity", for example "devbox · work-bot".
- A mate has one environment. The mate is on the machine of that environment. A mate never moves to a different machine.
- The UI does not use the words "Local", "Custom" or "Servers".

### Data on each machine (the daemon)

- Each daemon gets a stable machine ID. crew makes it one time and keeps it in `$CREW_HOME/config.toml` as `[machine] id`. The `hello` answer and `crew serve` send it.
- `[[env]]` becomes `[[identity]]`. The fields are `id`, `name`, `kind` (`yours` or `separate`) and the names of the set parts. The `yours` identity has the ID `yours`.
- The secret files move from `$CREW_HOME/secrets/env/<env>/` to `$CREW_HOME/secrets/identity/<id>/`. The harness directories move from `$CREW_HOME/envs/<env>/` to `$CREW_HOME/identities/<id>/`. The modes stay 600 and 700.
- The mate field `env` becomes `environment = {machine_id, identity_id}`. A daemon accepts only its own machine ID.
- The rules of ADR 0061 for the parts, the launch, the allowlist, the deny list, the hooks and the masking do not change. `yours` follows the rules of `local`. `separate` follows the rules of `custom`. `crew env exec` becomes `crew identity exec <id>`. The old name stays as an alias for one release.

### Data in the app

- The app keeps the list of machines. A machine has `id`, `name`, `kind` (`this` or `ssh`) and `ssh_address`. The login of each machine (its device token) stays in the store of the app, as today.
- On the desktop, `servers.json` becomes `machines.json`. The `url` kind goes away from the UI. An existing `url` server stays in the list until the user removes it. The app shows it as a machine that it cannot fix.
- The PWA keeps a list of paired machines in its storage. The phone pairs with each machine (ADR 0046 pairing, one time for each machine).
- "This Mac" is in the list only when the app runs on a Mac or a PC with a local daemon. It is hidden while no mate runs on it. When crew runs on a server, the first run does not show "This Mac".

### How the app talks to several machines

- The app opens one connection to each machine at the same time: the HTTP API and the WebSocket stream of `crew serve`.
- On the desktop, the Rust hub keeps one SSH tunnel for each `ssh` machine. The page of the local `crew serve` sends requests to the other machines through one new IPC command, `crew_machine_request {machine_id, method, path, body}`. Rust adds the token of that machine. Thus the page never holds the token of a remote machine, and a remote page still gets no IPC. The stream uses `crew_machine_stream`, which sends the frames as events.
- The PWA cannot use IPC. It calls the `crew serve` of each paired machine directly. For this, `crew serve` gets an option `[serve] allowed_origins`, a list of the origins that can call it with a bearer token. The `Origin` check of the stream also uses this list. The default is empty, so the behavior of today does not change.
- The merged list is a client merge. The client calls `environment.list` on each machine and merges the answers. It keeps the answers of the machines that answered. A machine that does not answer shows as "not reachable".
- The window switch goes away. The app has one window with all machines. The "This computer ▾" chip, the tray item "Open This computer", `#/servers` and Settings › Servers go away. "+ Machine" on the Environments page (frame 11d) replaces Add a server.

### RPC and serve

| Method | Route | Change |
|---|---|---|
| `environment.list` | `GET /api/v1/environments` | New. It replaces `env.list`. → `{"machine":{"id","name"},"identities":[...],"found":{...}}`. `found` is the logins that crew found (frame 11a). `env.list` stays one release as an alias. |
| `identity.set`, `identity.remove`, `identity.set_secret`, `identity.ssh_key` | `/api/v1/identities/...` | Renamed from the `env.*` methods. `identity.remove` refuses `yours`. |
| `mate.set` | `POST /api/v1/mates` | It takes `environment`. A different `machine_id` gets the error `wrong_machine`. |
| `mate.export` | `GET /api/v1/mates/{name}/export` | New. → the role, the memory, the look and the harness. No secret. |
| `mate.import` | `POST /api/v1/mates/import` | New. It makes a new mate from an export. If the name is in use, it adds a number ("ada-2") and answers with the new name. |
| `identity.copy_begin` | `POST /api/v1/identities/copy/begin` | New, owner only. The target machine makes a one-time X25519 key pair. It keeps the private key in memory for 5 minutes. → `{"copy_id","public_key"}`. |
| `identity.export` | `POST /api/v1/identities/{id}/export` | New, owner only. `{"public_key"}` → a sealed bundle (the git name and email, the GitHub token, the harness keys and the secret variables), encrypted to that key. It never has the SSH private key. |
| `identity.import` | `POST /api/v1/identities/copy/{copy_id}` | New, owner only. It opens the bundle, saves the secrets and makes a new SSH key. → the identity and its public key (frame 11h). |

- "Copy to another machine…" for a mate is a client flow: `mate.export` on the source, then `mate.import` on the target with an environment of the target. The original mate stays.
- "Copy to…" for a separate identity is a client flow: `identity.copy_begin` on the target, `identity.export` on the source with the public key, then `identity.import` on the target. The client only carries the sealed bundle. It cannot open it.

### Migration

- Each daemon migrates its config one time when it starts. It writes a backup of `config.toml` first.
  - It makes `[machine] id` if it is not there.
  - `[[env]]` with the kind `local` becomes the `yours` identity. Its extra variables stay. If there are two or more `local` environments, the first one becomes `yours`, and each other one becomes a separate identity with no parts and the same variables.
  - `[[env]]` with the kind `custom` becomes a separate identity with the same name.
  - It moves the secret and harness directories. If a move fails, it stops and keeps the old files.
  - A mate with an empty `env` or `env = "local"` gets `{this machine, yours}`. A mate with `env = "X"` gets `{this machine, X}`.
- The desktop app migrates `servers.json` to `machines.json` one time. "This computer" becomes This Mac. Each `ssh` server becomes an `ssh` machine with the same login. The selected server goes away.
- The PWA keeps its one paired server as its first machine.

### Security

- A secret goes from one machine to a different machine only through the app, over the authenticated API of each machine, and only in a bundle that is sealed to a one-time key of the target. The app does not keep the bundle.
- No secret shows in a log, a config file, an RPC answer that is not sealed, a notification or the UI. The masking of ADR 0016 applies.
- Only an owner device can call `identity.copy_begin`, `identity.export` and `identity.import`.
- The SSH private key never leaves its machine. The target machine makes a new key. The user adds it on GitHub (frame 11h).
- On the desktop, the tokens of the machines stay in Rust. The page gets only the answers.
- `allowed_origins` takes only exact origins. A `*` is refused.

## Why

- One list of environments with the machine in the name shows the user where a mate runs and with what accounts. There is one picker, not a switcher and a picker.
- A mate keeps its worktrees, its threads and its harness state on its machine. Thus a move is not safe. A copy is safe and simple.
- Each daemon keeps only its own data. Thus a daemon does not need to talk to a different daemon, and the trust model of `crew serve` does not change.
- A sealed bundle keeps the rule of ADR 0061: a client cannot read a secret.

## Limits

- An identity copy is a copy. A later change on one machine does not go to the other.
- The PWA needs `allowed_origins` on each machine that it calls. The user sets it when it pairs.
- A `url` server that is not over SSH has no Fix and no "+ Machine" flow.
