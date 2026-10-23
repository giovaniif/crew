# Live session

A session with a real agent pane: the chat sends a message to the agent and shows it in the transcript, and the Terminal, Shell and nvim tabs show live panes. `verify iso up --session` starts the e2e fake `claude` in a real tmux pane of the isolated crew, in the repo `TEST-live`. The fake echoes each line that it gets as `TEST echo: <line>` and writes a Claude transcript.

## Setup

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up --session
```

## Recipes

### Enter sends a message and it shows in the transcript

```sh
go run ./scripts/verify web drive / --viewport desktop --out-dir /tmp/crew-verify-map/live-session --steps '[{"click":{"text":"TEST live session","exact":false}},{"fill":{"role":"textbox","name":"Message"},"value":"TEST enter sends"},{"press":"Enter"},{"expect":{"text":"TEST echo: TEST enter sends"},"timeout":8000},{"shot":"chat-enter.png"}]'
```

Expect: the message and the echo of the agent show in the chat.

### the Send button sends a message and it shows in the transcript

```sh
go run ./scripts/verify web drive / --viewport desktop --out-dir /tmp/crew-verify-map/live-session --steps '[{"click":{"text":"TEST live session","exact":false}},{"fill":{"role":"textbox","name":"Message"},"value":"TEST click sends"},{"click":{"role":"button","name":"Send"}},{"expect":{"text":"TEST echo: TEST click sends"},"timeout":8000},{"shot":"chat-send.png"}]'
```

### Shift+Enter adds a line and does not send

```sh
go run ./scripts/verify web drive / --viewport desktop --out-dir /tmp/crew-verify-map/live-session --steps '[{"click":{"text":"TEST live session","exact":false}},{"fill":{"role":"textbox","name":"Message"},"value":"TEST one"},{"press":"Shift+Enter"},{"wait":1500},{"eval":"const v = document.querySelector(\"textarea[aria-label=Message]\").value; if (!v.includes(\"\\n\")) throw new Error(\"no new line: \" + JSON.stringify(v))"},{"expect":{"text":"TEST echo: TEST one"},"absent":true},{"shot":"shift-enter.png"}]'
```

### the agent screen shows the agent pane

```sh
go run ./scripts/verify web drive / --viewport desktop --out-dir /tmp/crew-verify-map/live-session --steps '[{"click":{"text":"TEST live session","exact":false}},{"eval":"location.hash = location.hash + \"/agent\""},{"wait":3000},{"eval":"const t = document.querySelector(\"[aria-label=\\\"Agent screen\\\"] .xterm-rows\").textContent; if (!t.includes(\"TEST fake claude\")) throw new Error(\"agent screen: \" + t.slice(-200))"},{"shot":"terminal.png"}]'
```

Expect: the text of the fake agent pane.

### Resume session from the agent screen connects to the new pane

```sh
go run ./scripts/verify web drive / --viewport desktop --out-dir /tmp/crew-verify-map/live-session --steps '[{"click":{"text":"TEST live session","exact":false}},{"click":{"role":"button","name":"Session commands"}},{"click":{"role":"menuitem","name":"End session…"}},{"click":{"role":"button","name":"End session"}},{"wait":3000},{"eval":"location.hash = location.hash + \"/agent\""},{"wait":3000},{"click":{"role":"button","name":"Resume session"}},{"wait":5000},{"eval":"const t = document.querySelector(\"[aria-label=\\\"Agent screen\\\"] .xterm-rows\").textContent; if (!t.includes(\"TEST fake claude\")) throw new Error(\"agent screen: \" + t.slice(-200))"},{"shot":"resume.png"}]'
```

Expect: the session ends, Resume session shows on the agent screen, and then the agent screen shows the new pane of the fake agent.

### the Shell drawer opens a shell in the worktree

```sh
go run ./scripts/verify web drive / --viewport desktop --out-dir /tmp/crew-verify-map/live-session --steps '[{"click":{"text":"TEST live session","exact":false}},{"click":{"role":"button","name":"Shell"}},{"wait":3000},{"press":"p"},{"press":"w"},{"press":"d"},{"press":"Enter"},{"wait":1500},{"eval":"const t = document.querySelector(\"[role=region][aria-label=Shell] .xterm-rows\").textContent; if (!t.includes(\"/TEST-live\")) throw new Error(\"shell: \" + t.slice(-200))"},{"shot":"shell.png"}]'
```

Expect: `pwd` prints the path of the `TEST-live` worktree.

### the editor opens nvim in the worktree

Needs: VERIFY_NVIM

```sh
go run ./scripts/verify web drive / --viewport desktop --out-dir /tmp/crew-verify-map/live-session --steps '[{"click":{"text":"TEST live session","exact":false}},{"eval":"location.hash = location.hash + \"/editor\""},{"wait":4000},{"press":"Escape"},{"press":":"},{"press":"p"},{"press":"w"},{"press":"d"},{"press":"Enter"},{"wait":1500},{"eval":"const t = document.querySelector(\"[aria-label=Editor] .xterm-rows\").textContent; if (!t.includes(\"/TEST-live\")) throw new Error(\"editor: \" + t.slice(-200))"},{"shot":"nvim.png"}]'
```

Expect: nvim opens on its start screen, and `:pwd` prints the path of the `TEST-live` worktree. Set `VERIFY_NVIM=1` when `nvim` is on `PATH`.

### app: Enter sends a message and it shows in the transcript

```sh
go run ./scripts/verify app drive / --out-dir /tmp/crew-verify-map/live-session --steps '[{"click":{"text":"TEST live session","exact":false},"timeout":15000},{"fill":{"role":"textbox","name":"Message"},"value":"TEST app enter"},{"press":"Enter"},{"expect":{"text":"TEST echo: TEST app enter"},"timeout":8000},{"shot":"chat-enter.png"}]'
```

Expect: the same as in the PWA, in the real desktop app.

### app: the Send button sends a message and it shows in the transcript

```sh
go run ./scripts/verify app drive / --out-dir /tmp/crew-verify-map/live-session --steps '[{"click":{"text":"TEST live session","exact":false},"timeout":15000},{"fill":{"role":"textbox","name":"Message"},"value":"TEST app click"},{"click":{"role":"button","name":"Send"}},{"expect":{"text":"TEST echo: TEST app click"},"timeout":8000},{"shot":"chat-send.png"}]'
```

### app: Shift+Enter adds a line and does not send

```sh
go run ./scripts/verify app drive / --out-dir /tmp/crew-verify-map/live-session --steps '[{"click":{"text":"TEST live session","exact":false},"timeout":15000},{"fill":{"role":"textbox","name":"Message"},"value":"TEST app one"},{"press":"Shift+Enter"},{"wait":1500},{"eval":"const v = document.querySelector(\"textarea[aria-label=Message]\").value; if (!v.includes(\"\\n\")) throw new Error(\"no new line: \" + JSON.stringify(v))"},{"expect":{"text":"TEST echo: TEST app one"},"absent":true}]'
```

### app: the agent screen shows the agent pane

```sh
go run ./scripts/verify app drive / --out-dir /tmp/crew-verify-map/live-session --steps '[{"click":{"text":"TEST live session","exact":false},"timeout":15000},{"eval":"location.hash = location.hash + \"/agent\""},{"wait":3000},{"shot":"terminal.png"},{"eval":"const t = document.querySelector(\"[aria-label=\\\"Agent screen\\\"] .xterm-rows\").textContent; if (!t.includes(\"TEST fake claude\")) throw new Error(\"agent screen: \" + t.slice(-200))"}]'
```

Expect: the text of the fake agent pane. The app starts its own `crew serve` with `PATH=/usr/bin:/bin`, as on macOS.

### app: the Shell drawer opens a shell in the worktree

```sh
go run ./scripts/verify app drive / --out-dir /tmp/crew-verify-map/live-session --steps '[{"click":{"text":"TEST live session","exact":false},"timeout":15000},{"click":{"role":"button","name":"Shell"}},{"wait":3000},{"press":"p"},{"press":"w"},{"press":"d"},{"press":"Enter"},{"wait":1500},{"shot":"shell.png"},{"eval":"const t = document.querySelector(\"[role=region][aria-label=Shell] .xterm-rows\").textContent; if (!t.includes(\"/TEST-live\")) throw new Error(\"shell: \" + t.slice(-200))"}]'
```

### app: the editor opens nvim in the worktree

Needs: VERIFY_NVIM

```sh
go run ./scripts/verify app drive / --out-dir /tmp/crew-verify-map/live-session --steps '[{"click":{"text":"TEST live session","exact":false},"timeout":15000},{"eval":"location.hash = location.hash + \"/editor\""},{"wait":4000},{"press":"Escape"},{"press":":"},{"press":"p"},{"press":"w"},{"press":"d"},{"press":"Enter"},{"wait":1500},{"shot":"nvim.png"},{"eval":"const t = document.querySelector(\"[aria-label=Editor] .xterm-rows\").textContent; if (!t.includes(\"/TEST-live\")) throw new Error(\"editor: \" + t.slice(-200))"}]'
```

Expect: nvim runs, also with the GUI `PATH` of the app, and `:pwd` prints the path of the `TEST-live` worktree.

## Cleanup

```sh
go run ./scripts/verify iso down
```

## Gotchas

- The text of a terminal is in the DOM rows of xterm.js. Check it with `eval` on the `.xterm-rows` of its region (`Agent screen`, `Shell` or `Editor`), not with `expect` on text: the sidebar also shows `TEST-live`.
- The desktop layout has no Terminal or nvim tab. The agent screen is the route `#/sessions/<id>/agent` and the editor is `#/sessions/<id>/editor`. The Shell button in the session bar opens the Shell drawer.
- The `app:` recipes need the desktop tools and build the app the first time (see `verify app` in the skill).
