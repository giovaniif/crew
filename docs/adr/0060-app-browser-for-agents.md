# ADR 0060: An app browser that agents control

Status: accepted, 2026-10-21. Issue #656. This ADR changes the "Not available" part of [ADR 0059](0059-tauri-browser-tab.md).

## Context

ADR 0059 shows the page of the Browser tab in an `iframe`. The UI cannot run scripts in a cross-origin `iframe`. Thus an agent cannot control the page that the user sees, and the agent uses the headless browser of the server ([ADR 0054](0054-headless-browser-fallback.md)).

The owner wants an agent to control the page in the app. The user must see each step and must be able to use the page at the same time.

The daemon already has the protocol for this ([ADR 0051](0051-browser-in-mac-app.md)):

- `browser.attach` makes a connection the browser of the daemon. The daemon pushes each command to that connection as a `BrowserCall`.
- `browser.reply` sends the result of one call back.
- `browser.command` (the `crew browser` CLI) goes to the attached browser. With no attached browser, it goes to the headless browser, if the config allows it.

The SwiftUI app used this protocol. The Tauri app does not use it yet.

## Decision

### A window, not a child webview

The app shows the page that an agent controls in a separate webview window. Its label is `browse-<n>`. Each session has its own window.

We do not use a child webview (`WebviewBuilder` and `Window::add_child`) in the `main` window:

- A child webview needs the `unstable` feature of Tauri.
- A child webview is a native view above the DOM. The app must move it each time the layout of the UI changes.
- A capability with `"windows": ["main"]` applies to each webview in the window `main`. Thus a child webview in `main` gets the capability of the UI if its page has the origin of `crew serve`.
- A window with the label `browse-<n>` matches no capability. Its label does not match `main` or `main-*`.

### The commands

The app runs the verbs of the headless browser in the window: `goto`, `snapshot`, `click`, `fill`, `type`, `press`, `wait`, `screenshot`, `eval`, `tabs`, `cookies`, `set-device` and `console`.

- `goto` calls `navigate` and waits for the page load event (`on_page_load`).
- `snapshot`, `click`, `fill`, `type`, `press`, `wait` and `eval` run a script in the page. The scripts are the same as the scripts of the headless browser. The snapshot gives the refs `@eN`.
- A script writes its result into the page. Rust reads the result with `eval_with_callback` until it is there. This also works for a script that returns a promise.
- `screenshot` uses `takeSnapshot` of `WKWebView` on macOS. On Linux and Windows, it is an error for now.
- `console` gives the last 200 console lines of the page. An initialization script keeps them.
- `cookies` uses `cookies_for_url`. `set-device` changes the size of the window.
- Before a click or a fill, the page shows an outline on the element for a short time. Thus the user sees the step.

The user can use the window at all times. The agent and the user act on the same page.

### The control channel

The app starts `crew browser attach` as a child process. This command connects to the daemon socket and sends `browser.attach`:

- It writes each `BrowserCall` as one JSON line to its output.
- It reads one JSON line for each result (`{"call","result"}` or `{"call","error"}`) from its input. It sends each one with `browser.reply`.
- It stops when its input closes or the daemon connection closes. The app then starts it again.

The bundled `crew` has the same build as the daemon, so the build handshake works. Rust has no RPC client.

`crew browser --browser app` sends a command only to the app. `--browser headless` sends it only to the headless browser. With no flag, the daemon uses the app if it is attached, else the fallback of the config. `app` has the same meaning as `mac`.

### Threat model

Assets: the Tauri commands of the app (`crew_notify`, `crew_attention`, `fix_daemon` and the server commands), the login of `crew serve` and the daemon socket.

Who can send commands to the browser window:

- Only a process of the owner. The commands come through the daemon socket (`$CREW_HOME/crew.sock`). The socket is a file of the owner. The daemon accepts a caller on the socket as the owner (see `internal/rpc`).
- An agent of a session runs as the owner, so it can control the window. This is the purpose of the feature.
- A paired device cannot control the window. `crew serve` has no route for `browser.command`.
- A remote server (a `url` or `ssh` server in the app) cannot control the window. The app attaches only to the daemon of this computer.

What the browsed page can do:

- The page can have any origin. This includes a dev server on `127.0.0.1` and a page that is hostile.
- The page gets no Tauri IPC. No capability matches the label `browse-<n>`. `capabilities/default.json` has no remote URLs, and `ipc::serve_capability` gives access only to `main` and `main-*`.
- The window refuses a navigation to the origin of `crew serve` and to a scheme that is not `http` or `https` (`on_navigation`). Thus the page cannot get the login of `crew serve` from the UI.
- The page does not get the results of the commands. Rust reads them with `eval_with_callback`, not with IPC.
- The page can change what the scripts return, the console lines and the refs. Thus a result is data of the page, not an instruction.

What the agent can do with the window:

- The agent can open any `http` or `https` URL and run JavaScript in it with `eval`. The agent can do the same with the headless browser and with its shell. Thus the window gives the agent no new access.
- The window uses the cookie store of the app webview. Thus the page can use the logins that the user makes in the window. The login of the UI is not a cookie, and a navigation to the origin of `crew serve` is refused.

Rules that stay:

- `capabilities/default.json` and the rules of `src/ipc.rs` do not change. `tests/ipc.rs` tests that no capability matches a `browse-<n>` window.

### The Browser tab

- In the Tauri app, each tab has "Open in app browser". It calls the command `crew_browser_open` with the session and the URL. Only the origin of `crew serve` can call it (`ipc::serve_capability`).
- When an agent sends a command for a session that has no window, the app opens one.
- The `iframe` of ADR 0059 stays. The PWA and the phone do not change.

## Consequences

- An agent controls a page that the user sees, and the user can take control.
- The page is in a separate window, not in the pane of the Browser tab.
- `screenshot` works only on macOS for now.
- Only the daemon of this computer can use the app browser. A session on an SSH server uses the headless browser of that server.
