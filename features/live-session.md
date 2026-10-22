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

Expect: the message and the echo of the agent show in the chat. Fails today: see #709.

### the Send button sends a message and it shows in the transcript

```sh
go run ./scripts/verify web drive / --viewport desktop --out-dir /tmp/crew-verify-map/live-session --steps '[{"click":{"text":"TEST live session","exact":false}},{"fill":{"role":"textbox","name":"Message"},"value":"TEST click sends"},{"click":{"role":"button","name":"Send"}},{"expect":{"text":"TEST echo: TEST click sends"},"timeout":8000},{"shot":"chat-send.png"}]'
```

### Shift+Enter adds a line and does not send

```sh
go run ./scripts/verify web drive / --viewport desktop --out-dir /tmp/crew-verify-map/live-session --steps '[{"click":{"text":"TEST live session","exact":false}},{"fill":{"role":"textbox","name":"Message"},"value":"TEST one"},{"press":"Shift+Enter"},{"wait":1500},{"eval":"const v = document.querySelector(\"textarea[aria-label=Message]\").value; if (!v.includes(\"\\n\")) throw new Error(\"no new line: \" + JSON.stringify(v))"},{"expect":{"text":"TEST echo: TEST one"},"absent":true},{"shot":"shift-enter.png"}]'
```

### the Terminal tab shows the agent pane

```sh
go run ./scripts/verify web drive / --viewport desktop --out-dir /tmp/crew-verify-map/live-session --steps '[{"click":{"text":"TEST live session","exact":false}},{"click":{"role":"tab","name":"Terminal"}},{"wait":3000},{"eval":"const t = document.getElementById(\"pane-terminal\").innerText; if (!t.includes(\"TEST fake claude\")) throw new Error(\"terminal pane: \" + t.slice(0, 200))"},{"shot":"terminal.png"}]'
```

Expect: the text of the fake agent pane. Fails today: see #719 and #710.

### the Shell tab opens a shell in the worktree

```sh
go run ./scripts/verify web drive / --viewport desktop --out-dir /tmp/crew-verify-map/live-session --steps '[{"click":{"text":"TEST live session","exact":false}},{"click":{"role":"tab","name":"Shell"}},{"wait":3000},{"press":"p"},{"press":"w"},{"press":"d"},{"press":"Enter"},{"wait":1500},{"eval":"const t = document.getElementById(\"pane-shell\").innerText; if (!t.includes(\"/TEST-live\")) throw new Error(\"shell pane: \" + t.slice(0, 200))"},{"shot":"shell.png"}]'
```

Expect: `pwd` prints the path of the `TEST-live` worktree. Fails today: see #719.

### the nvim tab opens nvim in the worktree

Needs: VERIFY_NVIM

```sh
go run ./scripts/verify web drive / --viewport desktop --out-dir /tmp/crew-verify-map/live-session --steps '[{"click":{"text":"TEST live session","exact":false}},{"click":{"role":"tab","name":"nvim"}},{"wait":4000},{"eval":"const t = document.getElementById(\"pane-nvim\").innerText; if (!t.includes(\"README.md\")) throw new Error(\"nvim pane: \" + t.slice(0, 200))"},{"shot":"nvim.png"}]'
```

Expect: nvim shows the files of the worktree (`README.md`). Set `VERIFY_NVIM=1` when `nvim` is on `PATH`. Fails today: see #719 and #710.

## Cleanup

```sh
go run ./scripts/verify iso down
```

## Gotchas

- The text of a terminal tab is in the DOM rows of xterm.js. Check it with `eval` on `#pane-<tab>`, not with `expect` on text: the sidebar also shows `TEST-live`.
- #709: Enter in the composer adds a new line and does not send. Only the Send button sends.
- #719: a session that `crew new` starts with no attached crew client has no window in the native tmux session. `crew serve` closes the terminal with 4404, and the tab shows "The pane is gone." The agent pane is live (`tmux capture-pane` shows it).
- #710: on macOS, the app starts `crew serve` with the GUI `PATH`, so the daemon can also lose tmux and nvim.
