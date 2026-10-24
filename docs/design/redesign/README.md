# App redesign

This folder is the source of truth for the redesign of the app (`web/`, used by the Tauri app and the PWA). The owner approved it on 2026-10-22. Mac first, light theme.

## Files

| File | Frames | What it shows |
|---|---|---|
| [crew.css](crew.css) | | The tokens and the classes. Copy the values exactly. |
| [1-session-chat-new-session-controls.html](1-session-chat-new-session-controls.html), [1.png](1.png) | 1a, 1b, 1c, 1d | Session chat, browser panel and shell drawer, new session, controls kit |
| [2-changes-session-menu.html](2-changes-session-menu.html), [2.png](2.png) | 2a, 2b, 2c | Changes (review), permission card, queued messages, the ⋯ menu, dialogs, toast |
| [3-mates-approvals.html](3-mates-approvals.html), [3.png](3.png) | 3a, 3b, 3c | Mates list and profile, new mate flow, approvals |
| [4-automations-disk.html](4-automations-disk.html), [4.png](4.png) | 4a, 4b | Automations table and side panel, worktrees and disk |
| [5-settings-servers.html](5-settings-servers.html), [5.png](5.png) | 5a, 5b, 5c, 5d | Settings: general, notifications, appearance, workspaces and servers |
| [6-onboarding-states.html](6-onboarding-states.html), [6.png](6.png) | 6a, 6b, 6c | First run, setup checklist, connection and empty states |

The HTML files are Claude Design canvases. They do not render alone (they need `support.js`). Read the markup and the class names, and use the PNG to see the result. `canvas.css` styles only the canvas frames. Do not copy it into the app.

## Rules

- Use the tokens of `crew.css` (`--fs-*`, `--h-ctl`, `--r-*`, colors). Do not add new sizes or colors.
- Base text is 13px. Controls are 28px high. Do not use 48px controls on desktop. The phone keeps 44px touch targets through a media query.
- No native `<select>`, `<datalist>`, checkbox, radio or number spinner. Use the kit of frame 1d: Select (a button that opens a Menu), Menu with search, Switch, Checkbox, Radio, Segmented, Stepper, Dialog, Toast.
- Show only what applies to the platform. The Mac app shows no iPhone or browser notes and no Sign out for the local server.
- Keep all behavior, API calls and tests. Change the look and the layout, not the features.

## Decisions

- Session tabs are only **Chat** and **Changes**. Shell is a bottom drawer (⌃`). The browser is a side panel that opens when the agent or a link opens a page. nvim is "Open in editor" (⋯ menu, ⌘E, and the file header in Changes). The agent's raw pane is "Show agent screen" in the ⋯ menu.
- The composer: Enter sends (or queues when the agent is busy), Shift+Enter adds a line. The send button is round and in the composer.
- New session is the composer on the home screen. Project, agent and effort are chips that keep the last choice. The first workspace of onboarding is the default project.
- Settings has one menu. The app settings and the server settings merge. A server-side row has a `server` tag.
- Connection problems show as a banner in the sidebar, not a full screen.

## Map: frame to code

| Frame | Replaces |
|---|---|
| 1a, 1b | `web/src/screens/Desktop.tsx` (shell, sidebar, toolbar), `Session.tsx` (Chat, Composer), `Terminal.tsx` (drawer), `Browser.tsx` (side panel), `desktop.ts` (tabs) |
| 1c | `NewSession.tsx` and the `.sheet` in `Desktop.tsx` |
| 1d | every native control in `screens/` |
| 2a | `Review.tsx` |
| 2b | `PermissionCard`, `Queued` in `Session.tsx`, `SessionCommands.tsx` |
| 2c | the dialogs of `SessionCommands.tsx` |
| 3a, 3b | `Mates.tsx` |
| 3c | `Approvals.tsx` |
| 4a | `Automations.tsx`, `AutomationsWindow` |
| 4b | `Disk.tsx` |
| 5a–5d | `Settings.tsx`, `ServerSettings.tsx`, `Servers.tsx` |
| 6a, 6b | Removed (issue #894). The first run is `FirstMate.tsx` (frame 12a). |
| 6c | `SessionList.tsx` connection states, empty states, `Terminal.tsx` gone state |
