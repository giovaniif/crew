# ADR 0061: Remove the TUI

Status: accepted, 2026-10-23. Issue #752. This ADR supersedes [ADR 0008](0008-tui-shell.md), [ADR 0037](0037-new-session-popup.md), [ADR 0042](0042-mouse.md) and [ADR 0047](0047-workspace-path-input.md). It changes the "The TUI stays" rule of [ADR 0057](0057-tauri-apps.md).

## Context

`crew` had two UIs: the TUI (`crew tui` in the client layout) and the app. The app is the React UI in `web/`, in a browser or in the Tauri app ([ADR 0057](0057-tauri-apps.md)).

The owner works from macOS through the app. The owner does not use the TUI.

The next work is mates, then local harness sessions. Each feature had to go into the TUI and the app. The TUI was about 16,000 lines of Go, goldens and tests.

## Decision

- Remove `internal/tui`, `crew tui` and the Bubble Tea and Lip Gloss dependencies.
- The app is the only UI. `crew serve` gives the app its API. The Tauri app starts `crew serve` itself.
- `crew` with no arguments does not attach to a tmux layout. It tells you to open the crew app, prints the usage and exits with status 2.
- `crew setup` with no arguments prints the setup usage.
- Remove `scripts/screenshot`, the `tui` commands of `scripts/verify`, the TUI e2e script and the TUI README images.
- For PR screenshots, use `verify web shot` or `verify app shot`.

These parts stay: the daemon, `crew hook`, `crew serve`, `crew rpc`, the other CLI subcommands, `internal/rpc`, `internal/view`, `internal/syntax` and the tmux adapter. Agents still run in panes on the `crew` tmux server.

## Consequences

- A user who runs `crew` in a terminal gets a hint and not a UI.
- There is less code to change for each new feature.
- The daemon still has the `client.open` layout methods. No client of this repo calls them now. A later change can remove them.
- The older ADRs that describe the TUI stay as a record. Their TUI parts do not apply.
