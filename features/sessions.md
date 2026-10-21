# Sessions

The sidebar and the PWA list every session, grouped by task, with its state, harness, model and limits. A session that needs the user (permission or waiting) is first in the PWA and counted as "need you" in the TUI. The TUI and the PWA must agree on the sessions and their states.

## Setup

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up
go run ./scripts/verify iso seed --sessions 3
```

## Recipes

### sidebar lists the seeded sessions

```sh
go run ./scripts/verify tui drive --restart --out-dir /tmp/crew-verify-map/sessions --steps '[{"expect":"seeded change 1","timeout":8000},{"expect":"seeded change 3"},{"expect":"1 need you"},{"shot":"sidebar.png"}]'
```

Expect: two tasks (`seeded task 1`, `seeded task 2`), three sessions, the Claude 5h limit at 88%.

### j and k move the selection

```sh
go run ./scripts/verify tui drive --out-dir /tmp/crew-verify-map/sessions --steps '[{"expect":"seeded change 2","timeout":8000},{"keys":"j"},{"keys":"j"},{"expect":"opus-5.5"},{"shot":"moved.png"}]'
```

### help toggles with ?

```sh
go run ./scripts/verify tui drive --out-dir /tmp/crew-verify-map/sessions --steps '[{"keys":"?"},{"expect":"keys","timeout":3000},{"keys":"?"},{"shot":"help.png"}]'
```

### PWA groups sessions by attention on mobile

```sh
go run ./scripts/verify web drive / --viewport mobile --out-dir /tmp/crew-verify-map/sessions --steps '[{"expect":{"text":"seeded change 2"}},{"expect":{"text":"Needs you","exact":false}},{"expect":{"text":"Working","exact":false}},{"expect":{"text":"Done","exact":false}},{"shot":"list.png"}]'
```

Expect: mobile shows Needs you 1, Working 1, Done 1. No console errors and no failed API calls.

### PWA desktop sidebar lists the sessions in daemon order

```sh
go run ./scripts/verify web drive / --viewport desktop --out-dir /tmp/crew-verify-map/sessions --steps '[{"expect":{"role":"navigation","name":"Sidebar"}},{"expect":{"text":"Sessions","exact":false}},{"expect":{"text":"seeded change 1"}},{"expect":{"text":"seeded change 2"}},{"expect":{"text":"Ctrl+Shift+1"}},{"shot":"sidebar.png"}]'
```

Expect: one flat Sessions list with a state dot and a `Ctrl+Shift+<n>` key for each session. The desktop sidebar has no attention groups.

### PWA opens a session chat

```sh
go run ./scripts/verify web drive / --viewport mobile --out-dir /tmp/crew-verify-map/sessions --steps '[{"click":{"text":"seeded change 1"}},{"expect":{"role":"textbox","name":"Message","exact":false}},{"shot":"chat.png"}]'
```

### CLI reads back the seeded worktrees

```sh
go run ./scripts/verify iso crew --expect seed-1-api --expect "#100 OPEN failing" -- worktree list
```

### PWA clears unread when the session is viewed

```sh
go run ./scripts/verify iso seed --sessions 3
go run ./scripts/verify web drive / --viewport mobile --out-dir /tmp/crew-verify-map/sessions --steps '[{"expect":{"text":"unread","exact":true}},{"click":{"text":"seeded change 3"}},{"expect":{"text":"No messages yet"}},{"wait":1500},{"click":{"text":"Sessions","exact":false}},{"expect":{"text":"seeded change 2"}},{"wait":1500},{"eval":"if ([...document.querySelectorAll(\".badge\")].some((b) => b.textContent === \"unread\")) throw new Error(\"unread after view\")"},{"shot":"read.png"}]'
```

Expect: the `unread` badge of `seeded change 3` is gone after the chat opens. See #488.

### PWA names a root session by its workspace

```sh
rm -rf /tmp/crew-verify-map/TEST-root && mkdir -p /tmp/crew-verify-map/TEST-root
go run ./scripts/verify web drive /#/new --viewport mobile --out-dir /tmp/crew-verify-map/sessions --steps '[{"click":{"role":"button","name":"Add workspace…"}},{"fill":{"label":"Folder on the server","exact":false},"value":"/tmp/crew-verify-map/TEST-root"},{"click":{"role":"button","name":"Add","exact":true}},{"wait":800},{"fill":{"label":"First prompt","exact":false},"value":"TEST root"},{"click":{"role":"button","name":"Start session"}},{"expect":{"text":"TEST-root · claude"}},{"shot":"root.png"}]'
go run ./scripts/verify iso crew --expect "removed /tmp/crew-verify-map/TEST-root" -- workspace remove /tmp/crew-verify-map/TEST-root
rm -rf /tmp/crew-verify-map/TEST-root
```

Expect: the chat header of a session with no worktree names its workspace. See #557.

### new session dialog with a real harness (manual: the fake claude holds the pane but does not run turns; use make dev FAKES=1 to try it)

### workspace add, list and remove a TEST repo

```sh
rm -rf /tmp/crew-verify-map/TEST-ws && mkdir -p /tmp/crew-verify-map/TEST-ws
git -C /tmp/crew-verify-map/TEST-ws init -q
git -C /tmp/crew-verify-map/TEST-ws commit -q --allow-empty -m init
go run ./scripts/verify iso crew --expect "added /tmp/crew-verify-map/TEST-ws" -- workspace add /tmp/crew-verify-map/TEST-ws
go run ./scripts/verify iso crew --expect "TEST-ws  main" -- workspace list
go run ./scripts/verify iso crew --expect "removed /tmp/crew-verify-map/TEST-ws" -- workspace remove /tmp/crew-verify-map/TEST-ws
rm -rf /tmp/crew-verify-map/TEST-ws
```

### P opens the projects view

```sh
go run ./scripts/verify tui drive --restart --out-dir /tmp/crew-verify-map/sessions --steps '[{"expect":"seeded change 1","timeout":8000},{"keys":"P"},{"expect":"PROJECTS"},{"expect":"a add"},{"shot":"projects.png"},{"keys":"Escape"}]'
```

### crew new starts a session from the CLI (manual: it needs a workspace and a harness that runs turns)

### crew focus moves the TUI to a session (manual: it needs an attached crew client)

### crew statusline prints the Claude Code status line (manual: Claude Code calls it with JSON on stdin)

### session keys x, u, M, E, R, A, K, o, tab, space and 1-9 (manual: each acts on a live harness pane; the seeded sessions have no pane)

## Cleanup

```sh
go run ./scripts/verify iso down
```

## Gotchas

- `crew tui --new-session` opens the new session dialog over the sidebar. `verify tui` runs `crew tui` with no flag.
- The seeded worktrees are in `/tmp/seed`. They are not git repos, so `git status` fails on them.
