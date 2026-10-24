# ADR 0057: One Tauri 2 app for desktop and mobile

Status: accepted, 2026-10-20. Issue #511. This ADR replaces the UI part of [ADR 0049](0049-macos-app.md). It changes the "Mac app is the primary UI" rule of #439. The work items have the label `tauri` (#512 to #531). [ADR 0062](0062-remove-the-tui.md) removes the TUI.

## Context

`crew` has three UIs: the TUI, the PWA in `web/` and the SwiftUI app in `macos/`. The PWA and the SwiftUI app show the same screens, but they are two code bases in two languages. Each UI change must be made two times.

The SwiftUI app runs only on macOS. The owner also wants the app on Linux, Windows, iOS and Android.

The owner decided on 2026-10-20 to use Tauri 2 for all of these platforms. There is no proof of concept. The work starts at once.

## Decision

### The shell and the UI

- One Tauri 2 app holds the UI. The Rust crate is in `desktop/`. It is small: it opens the window, finds the daemon and gives a few native functions to the UI.
- The UI is the React and TypeScript app in `web/`. The PWA and the Tauri app use the same code. Platform code goes behind a port in `AppEnv`, so that tests can give fakes.
- The app keeps the structure of the SwiftUI app: the sidebar, the toolbar, the sheets, the Mates window (gallery, create, profile), the Chat tab, the Terminal, Shell and nvim tabs, the review pane, the Fix button of the daemon and Start fresh.
- The app uses a white, light theme (Latte). It has a dark theme (Mocha). It does not copy the native macOS look. It uses the same look on all platforms.

### The daemon

- The Go daemon does not change. It stays the core. The TUI stays.
- The app talks only to `crew serve` (HTTP and the WebSocket stream of [ADR 0046](0046-remote-app.md)). It does not talk to the daemon socket directly. Thus one client works on all platforms.
- When a Mac screen needs a daemon method that `crew serve` does not have, add a route to `crew serve`. Do not add a second protocol.

### How the app finds the daemon

- Desktop (macOS, Linux, Windows):
  1. The app starts `crew serve` on `127.0.0.1` with a random port. It uses the `crew` binary of the bundle, else `crew` on `PATH`.
  2. The app pairs itself with a one-time code from the local `crew` CLI. The token stays in the store of the app.
  3. If no daemon runs, the app shows the Fix button. Fix runs `crew setup daemon`, then connects again.
  4. A remote server is a second entry in the server list. The app pairs with its `crew serve` as a phone does.
- Mobile (iOS, Android):
  - The app connects to a remote `crew serve` only. It uses the pairing of ADR 0046: a QR code or the code from `crew pair`.
  - The app keeps the same pairing and the same token rules as the PWA.

### Terminals

- The Terminal, Shell and nvim tabs use xterm.js.
- `crew serve` gets a terminal route on the stream. It sends the output of a tmux pane and takes keys and sizes. It uses the same control-mode method as the SwiftUI app (`client.native`, `tmux -C`).
- On mobile, the terminal tabs are available, but the Chat tab is the first tab.

### Tests

- UI tests: Vitest and Testing Library in `web/`, as in [ADR 0048](0048-web-toolchain-and-tdd-parity.md). Playwright takes the screenshots.
- End-to-end tests: `tauri-driver` (WebDriver) on Linux. They start a fake API or a temporary daemon with a temporary `CREW_HOME` and `CREW_TMUX_SOCKET`. They never touch the real `~/.claude`, `~/.codex` or `~/.crew`.
- CI builds the app on Linux and on macOS. `tauri-driver` has no macOS driver, so macOS gets a build only.
- CI builds iOS on macOS without a signature (a development build). CI builds Android on Linux.
- The TDD rules of the root `AGENTS.md` apply to `desktop/` too.

### Release and update

- A workflow builds the desktop packages (DMG, AppImage, deb, MSI) for each release tag. It uses the `crew` binaries that goreleaser makes and puts them in the bundle.
- The Tauri updater plugin updates the desktop app from the GitHub release.

### The end of the SwiftUI app

Remove `macos/`, its CI jobs and its release job only when all of these conditions are true:

- Each screen of the inventory issues (label `tauri`) is in the Tauri app, and its issue is closed.
- The Tauri macOS package is in a release, and the owner used it for one week.
- The owner agrees in the removal issue.

Until then, the SwiftUI app gets only bug fixes.

The owner agreed on 2026-10-21 in #531. #531 removed `macos/`, the `macos` CI job and the `macos-app` release job.

## Consequences

- One UI code base for five platforms. A UI change is made one time.
- `crew serve` gets more routes. Each route needs a golden test, as the routes of ADR 0046 have.
- The app does not look native on macOS. The owner accepts this.
- The build needs Rust and the Tauri system libraries. `go build` and `make web` do not need them.
- The browser of [ADR 0051](0051-browser-in-mac-app.md) and its cookie import use WebKit APIs of macOS. They need a new design for Tauri. A separate issue holds this work.

## Amended by ADR 0063 (2026-10-23)

- The server list becomes a list of machines. The app shows all machines in one window and one merged list. The server switcher and Settings › Servers go away. See [ADR 0063](0063-environments-are-machine-plus-identity.md).
