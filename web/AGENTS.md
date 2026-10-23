# web

The phone app: a PWA that `crew serve` embeds and serves at `/` (ADR [0046](../docs/adr/0046-remote-app.md)). The toolchain and decisions are in ADR [0048](../docs/adr/0048-web-toolchain-and-tdd-parity.md). The repo-wide rules in the [root AGENTS.md](../AGENTS.md) also apply here, for example no comments and test first.

## Commands

- Run `npm ci` one time. Then run `npm test` (Vitest, jsdom) and `npm run typecheck`.
- `make web` (from the repo root) builds into `internal/serve/dist`. It writes the shell as `app.html`. The committed `index.html` in that dir is the placeholder that a `go build` without Node embeds. Then `make build` gives a binary that serves the app.
- `npm run dev` runs Vite.
  - `CREW_API=http://127.0.0.1:7420 npm run dev` proxies `/api` (and the stream) to a running `crew serve`.
  - Add `CREW_API_INSECURE=1` to accept its `--self-signed` certificate.
  - `npm run fake` uses the fake API in `fake-api.ts` instead.
  - The dev server binds all interfaces and accepts `.ts.net` hosts.
- `npm run icons` redraws the PNG icons in `public/` from `public/icon.svg` with Playwright.
- `scripts/web-screenshot` (see [scripts/](../scripts/AGENTS.md)) takes the PR screenshots.

## Layout

- `src/api.ts`: the HTTP client. Each error is an `ApiError` with the HTTP status and a code. The code is one of these:
  - the server's `error.code`
  - else, a code from the status (`401` → `unauthorized`, `429` → `rate_limited`)
  - `network`, when the client cannot get to the server.
- `src/App.tsx` selects the screen:
  - the session list, when `localStorage` holds `crew.auth` (it copies the login of the alphas one time, see `src/legacy.ts`)
  - Add to Home Screen, in a browser tab
  - pairing, in the installed app.

  `AppEnv` holds all inputs from the browser (fetch, storage, display mode, URL hash, host, user agent), so tests can give fakes.
- `src/build.ts` and `src/sw.ts`/`src/sw-cache.ts`: the app registers the worker as `/sw.js?build=<hello build>`. The worker caches into `crew-shell-<build>` (activate deletes the caches of the alphas and old `crew-shell-*` caches). If the worker build of a page is not the build of `hello`, `checkBuild` reloads the page. `vite.config.ts` writes the built file list into `sw.js`.
- `src/stream.ts`: the `/api/v1/stream` client and its types. The types use the Go field names that the goldens pin. `StreamClient`:
  - sends the token first and applies diffs (`applyDiff`)
  - backs off from 1 s, doubling to 30 s. The backoff resets when a state arrives.
  - on close code 4401, asks `confirmRefused` before it stops. The app passes `tokenRefused`, an authed `GET /api/v1/workspaces`. Only a 401 `unauthorized` from that call makes the status `unauthorized`. All other results (success, 5xx, a network error) retry with the same token, as for all other closes.
  - retries on all other close codes, also 4400 (a late or malformed first frame).

  The connection banner (`Connection` in `screens/SessionList.tsx`) has these states, as in the Mac app: Connecting…; No crew daemon · retrying (close 1013, with the reason); Reconnecting in N s (other closes); Build mismatch · stopped (close 4502, no retry, with Reconnect). In the desktop app (`AppEnv.desktopFix`, see `src/desktop-host.ts`), the retrying states show Fix instead of Retry now. Fix shows Fixing the daemon, then connects again. A failed Fix shows Fix failed · retrying with the reason. If the app cannot start `crew serve`, the bundled connect page (`desktop/connect/index.html`) shows the problem and Fix. Tests: `npm test -- Connection`.

  The app forgets `crew.auth` (it copies the login of the alphas one time, see `src/legacy.ts`) only on `unauthorized` (or Sign out). Then it shows pairing, with a note that the device was removed or its login was rejected. Tests: `npm test -- stream SessionList`.
  - `onFrame` passes all frames (transcripts, watch errors). `send` writes `watch`/`unwatch` frames while `live`.
  - With `visible` set (`AppEnv.visibility`, `document.visibilityState` in `main.tsx`), it sends `{"visible":bool}` when live and on each `visibilitychange` (`visibilityChanged`). While the app is shown, it sends `{"visible":true}` every 30 s. Thus the daemon does not push to a phone that has the app open.
  - `useStreamClient` owns one client for each token. `useStream` reads its `StreamSnapshot` (`status`, `state`, `retryAt`).
  - The app holds one client in `App` and shares it with all screens. When the status goes back to `live`, a screen that watches a session sends its `watch` again.
- `src/api.ts` also has the authed session calls (`Authorization: Bearer <token>`): `messagesPage`, `sendMessage`, `unsend`, `interrupt`.
- `src/transcript.ts` keeps the messages of one session.
  - Pages and `transcript` frames merge by `id`, in `cursor` order. A later copy replaces the earlier copy in place, so a finished tool call updates its row.
  - A `reset` starts again and makes `before` unknown (`null`). Thus the next load of older messages asks for the newest page.
  - `toolRow` splits the tool name from `Tool.Summary`. `testResult` reads a go test, Vitest/Jest, pytest or cargo summary from the output.
  - A `Message` has no diff counts, so tool rows do not show them.
- `src/screens/Session.tsx` is the chat. It has the header, the log and the composer.
  - The header shows the name, `where`, harness and model, context left, a state chip and a `muted` mark for a muted session. While the session runs or asks permission, it also shows Interrupt, behind a confirmation.
  - The log loads the newest page (50). Then it sends `watch` with the newest cursor it holds. It sends `watch` again each time the stream is `live` again. It sends `unwatch` when it closes.
  - A scroll near the top (or the button of the top row) loads the page before `before`. To keep the reading position, the log adds the height that it grew to `scrollTop`, because iOS Safari has no `overflow-anchor`. While the top row says loading, it keeps one height, so it never moves the log.
  - New messages scroll to the bottom only while the reader is at the bottom.
  - The composer sends with `POST …/messages`. While the session runs or asks permission, the button says Queue.
  - The queued sends of the session (stream `sends`) are above the composer. Each has Edit (unsend, then the text goes back into the composer) and Drop (unsend). If a send already went out (`not_found`), the app tells you.
  - The end of the log (`Chat`'s `children`, `.chat-end`) holds the permission card (`PermissionCard`). While the session state is `permission`, the card fetches `GET …/prompt`. It fetches again each time `since` changes, that is, when the session enters permission again. It shows the text with one button for each choice (`POST …/answer {choice}`).
  - A 409 `stale`, a `not_found`, or a stream that leaves `permission` changes the card to "This prompt is gone", and nothing is sent. A prompt with `raw` and no choices shows "Couldn’t read this dialog" and the raw pane text, with no buttons.
  - While the state is `permission`, the composer is disabled. Tests: `npm test -- Permission`.
- `src/sessions.ts`: the groups by attention, the time in state, and the limits rows. The groups are:
  - Needs you: permission, then waiting, longest first.
  - Working.
  - Done: unread first.
  - Idle.

  Ended sessions are not shown.
- `src/route.ts`:
  - `#/sessions/<id>` opens a session. Push notifications use the same URL.
  - `#/new` is the new session home composer (`screens/NewSession.tsx`, frame 1c): "What should the agent do?", one task box (a PR or issue URL is the work item; else the first line is the work item and a multi-line text is also the first prompt), and the Project, Agent (harness and model) and Effort chips. Enter starts. On the desktop it fills the main column (no sheet). After 350 ms, the form checks the work item through `/work-items/resolve`. It keeps the choices in `crew.new` in `localStorage`. The default workspace is the last one that the daemon used. A launch error, also the output of a setup recipe, shows in the form. A success opens `#/sessions/<id>`.
  - All other routes show the list.
- `src/push.ts` and `src/sw-push.ts`: Web Push. `AppEnv.push` (`browserPush(window)` in `main.tsx`, `FakePush` in tests) wraps `Notification` and `pushManager`.
  - When Settings opens, it reads the real state. If permission is granted, it calls `PushEnv.subscribed()`: the `pushManager` of the worker registration holds a subscription. Then it shows "Notifications are on for this device" with Turn off (`disablePush`), not Enable. It does not ask the server, because the server has no endpoint that reports the subscription of a device.
  - `enablePush` runs only from the Settings button. It asks for permission first, because iOS needs a tap from the user for this. Then it calls `GET /api/v1/push/key`, subscribes with that key, and posts the subscription to `/api/v1/push/subscribe`.
  - The `push` handler of the worker shows `{"title","body"}`, tagged by session. It never pushes silently: if a field is missing, it uses `crew` / `needs you`.
  - `notificationclick` focuses an open window of the app and navigates it to the `url` of the push (`/#/sessions/<id>`, same-origin paths only). If no window is open, it opens one.
  - Settings also shows static text: pushes are held while the owner types at the terminal, and are not sent while the app is on screen.
  - Sign out first calls `POST /api/v1/push/unsubscribe` and unsubscribes the browser, then calls `POST /api/v1/unpair` (both best effort). Then it forgets the token.

  Tests: `npm test -- Push` and `npm test -- Settings`.
- `src/desktopBridge.tsx` and `src/desktopAttention.ts`: the desktop app (see [desktop/](../desktop/AGENTS.md)). `AppEnv.desktop` is set only in the Tauri window.
  - `bannerStep` posts one banner for each new `banner` of a session. It posts nothing for the banners that were there when the stream connected. A newer banner of the same session replaces the older one.
  - It skips muted sessions, the events that the settings turn off, and the session in view while the window is in front. The settings are in `crew.alerts` in `localStorage`. Their defaults are the defaults of the Mac app. Settings shows them in the desktop app only.
  - The app sends `{"viewing":{"session","front"}}` on the stream when the route, the focus or the visibility changes. serve passes it to `client.viewing`.
  - `attentionMenu` gives the tray rows and the badge.
  - Tests: `npm test -- Attention`.
- `#/automations` (`screens/Automations.tsx`) lists the automations with agent, trigger and state. Run… opens a form with a multi-line context and an optional work item, then posts `/api/v1/automations/<name>/run`. A started run opens its session. A skipped or failed run shows its reason. Tests: `npm test -- Automations`.
  - Issue #524: the screen has search (name and prompt), filters (state, last outcome, agent) and sort (name, last run). `src/automations.ts` holds these rules (`automationRows`) and the draft of the form (`draftOf`, `automationOf`), as `Automations.swift` of the Mac app does.
  - The redesign (frame 4a, issue #726) shows a table: Name, Trigger, Agent, Last run (an outcome pill and the time since) and an enable Switch. The Switch saves the automation with `enabled` changed. A repo automation has a disabled Switch. The filters are chips that open a kit Menu. The Name and Last run column heads sort.
  - A click on a row opens a 380px side panel with Run now, Edit, and the sub-tabs Details (the fields, the prompt, the source file and the recent runs with Open) and History (all runs, Open session and Rerun, which posts `/api/v1/automations/runs/<id>/rerun`). Edit and New automation show the form in the same panel.
  - New automation and Edit post `/api/v1/automations` (`automation.save`). A repo automation (its source ends with `/.crew.toml`) shows that file and has no Edit.
  - Save and Rerun are owner-only routes. Another device gets a note.
- **Faces.** `src/faces.ts` has the 12 faces of the design (`FACES`: id, name, accent for light and dark, the SVG parts and the 2-line TUI glyph), `faceSvg` and `faceGlyph`. The TUI and the Mac app use the same rules:
  - The face of a mate is its `avatar` (from the stream row, else from `GET /api/v1/mates`) if that is a face id. Else it is the face with the id of the mate name. Else it is `FACES[sum of the UTF-8 bytes of the name % 12]`. The color is the `color` of the mate, else the accent of the face.
  - `faceState`: `paused` if the mate is paused or a guard holds it. Else `needs` if the mate has a pending approval, or a thread or conversation that is not ended waits or asks for permission. Else `working` if one runs. Else `idle`.
  - The tone axes and their sentences come from the server (`tones` of `GET /api/v1/mates`). The app keeps no copy of the sentences. `toneLines` gives the sentences of the chosen steps, and `toneOf` gives the `tone` that the app sends (`{key: step}`, 1 to 5). The server adds the sentences to the system prompt, so the prompt text stays clean.
- `#/mates` (`screens/Mates.tsx`) is a list and a profile side by side (frame 3a of `docs/design/redesign/`). The list at the left (280 px) has Stop all, New mate (to `#/mates/new`), the search, the All / Claude / Codex filter and two groups: Needs you (a mate with a face state `needs`) and All mates. Each row shows the face, the name, the persona and the agent, and a state dot or a `paused` pill. `#/mates` shows the profile of the first mate. On a narrow window, `#/mates` shows only the list and `#/mates/<name>` only the profile.
  - The kill switch: Stop all opens a dialog first, then posts `/api/v1/mates/stop` `{"stop":true}`. While the stream says `stopped`, the list shows Start all mates, and the session list shows "All mates are stopped".
- `#/mates/<name>` is the profile: the big face, the persona and the state, Pause or Resume and Settings, four fact cards (Agent, Repos, Memory with the meter, Slack), and these parts:
  - "+ New conversation" posts `/api/v1/mates/<name>/new` and opens the new session.
  - Conversations: the local `conversations` of the stream (`session`, `name`, `state`, `ended`, `started_at`), then the Slack threads (each with a Slack link).
  - Memory: `GET …/memory`. Edit opens a text box, and Save memory posts `{"text"}`. Empty text clears it.
  - Pause or Resume (`POST …/pause|resume`) and Settings (agent, model, effort, repos, prompt, posted to `/api/v1/mates`).
  - Connect… in the Slack card, only while the state is `ready` or `no_tokens`. It shows the manifest link (`GET …/setup`), takes the two tokens (`POST …/tokens`) and shows the claim code (`POST …/claim`). Slack is optional.
- `#/mates/new` makes a mate in four steps under a thin progress bar (frame 3b), with Cancel, Back and Next: 1 face, color and name (as in the Mac app, a name that is not a handle or that a mate has already disables Next); 2 the prompt, four preset cards and the tone sliders (from `tones`), with the "Added to the prompt" box; 3 agent (Segmented), model, effort and repos; 4 meet. Create posts `/api/v1/mates` with `avatar`, `color`, `tone` and `enabled: true`, then opens the profile.
- A session of a mate (`Mate.Name` in the stream) shows a bar over the chat header: the face, the name and the state, and Start fresh. Start fresh posts `/api/v1/sessions/{id}/fresh` (`mate.fresh`) and opens the new session. The daemon asks the old session for a handoff to the memory. "Keep this worktree" is on by default (`same_worktree`). The old session continues.
- The chat of a mate session is the Chat view of the Mac app. Each reply of the agent shows the face of the mate (28 px, with its state) and its name with a capital first letter, in a bubble (`.msg-mate`). The composer says "Message <Name>…". A session of no mate shows no face.
  - A session that Start fresh made has `Mate.FreshFrom` (the old session id). The chat loads the newest page of the old session one time. It shows those messages above a dashed divider "Earlier conversation ended · handoff saved to memory", the same as the Mac app. A session with no `FreshFrom` shows no divider.
- Tests: `npm test -- Mates faces`.
- `#/approvals` (`screens/Approvals.tsx`) shows the count and a card for each pending approval of a mate (`GET /api/v1/approvals`, frame 3c): the face, the mate, the action, who asked, the tool, how long ago, the time until it expires, a link to the session and the exact input in a mono block. A decided card turns muted and keeps Open session. Approve and Deny post `/api/v1/approvals/<id>/approve|deny`, then the card shows the result. A 409 `stale` or a `not_found` shows "This approval is gone". The push of an approval opens this screen. Tests: `npm test -- Approvals`.
- `#/settings` (`screens/Settings.tsx`) shows Settings (frames 5a to 5d of [the redesign](../docs/design/redesign/README.md)). A tab bar under the session list and Settings switches between them. On the desktop layout, the Settings link of the sidebar opens it in the main column. One left menu (Back, Esc) has General, Notifications, Appearance, Shortcuts, Workspaces, Agents, Devices and, in the desktop app, Servers (`#/servers` opens it). Each pane is grouped rows (`screens/SettingsRows.tsx`): the label at left, a kit control at right. Only the pane scrolls, so the menu column fills the window. Notifications keeps its rows in `crew.alerts`, the store that the banners read: a Switch for each event and a Sound checkbox. A row that the server keeps has a `server` tag.
  - The app keeps its options in `crew.settings` in `localStorage` (`src/settings.ts`). The Theme option sets `data-theme` on `<html>`, and `theme.css` has a palette for each value. General also has this device, the server (Change server), Enable notifications and Sign out. The desktop app on its own server (`desktopAuth`) has no Sign out.
  - The server options (`screens/ServerSettings.tsx`): Workspaces (Add a folder… opens the path field with the folders of `GET /workspaces/dirs`; the ⋯ menu removes after a confirm; in the desktop app, Browse… next to the path field opens the folder dialog (`crew_pick_folder {near}`, `screens/BrowseButton.tsx`) next to the last workspace and fills the field. While the dialog is open, `<html>` has `data-picking`, and the sheet has no scrim), Agents (hooks, default model and effort, `fallback.threshold`, nvim), `push.away_after` in Notifications, Devices (Revoke after a confirm, Pair a device).
  - A server group that gets `unknown_method` shows a note that the server does not have this setting. A group that gets `forbidden` shows a note that only the owner device can change it.
  - `src/shortcuts.ts` has the shortcut rules of the Mac app: a combo needs Cmd or Ctrl, Cmd or Ctrl with 1 to 9 is for the session jumps, a combo cannot have two actions, and the fixed combos (Cmd+, and the review keys) stay. Tests: `npm test -- Settings Shortcuts`.
- `#/disk` (`screens/Disk.tsx`) is the worktrees and disk window of the Mac app (issue #520). The sidebar of the desktop layout links to it. The phone layout shows it too.
  - `src/disk.ts` holds the pure rules, the same as `Disk.swift`: `diskTiles`, `diskRows` (the state Open, Merged · clean, Merged · dirty, Detached or No PR, and what cleanup does), `diskActions`, `diskPorts`, `diskRecent` and `pollDelay`.
  - It loads `GET /api/v1/disk` every 2 s while a size is pending, else every 10 s.
  - Each destructive action (Remove…, Back up and remove…, Kill…) asks first. A `keep` row offers no removal. A `backup_then_ask` row offers only Back up and remove. The daemon applies the cleanup rules again.
  - The redesign (frame 4b, issue #727): a head with Clean up now (asks first, then posts `/api/v1/cleanup/run`), five stat cards (`diskCards`: Volume with a usage bar, Worktrees, Reclaimable, Shared deps store, Auto-cleanup), the sub-tabs Worktrees N, Dev servers N and Recently cleaned, and tables with state pills. Each confirm is a kit `Dialog`. A dev server row has Stop….
  - Go to session opens `#/sessions/<id>`. Open shell posts `…/shell` with the worktree, then opens `#/sessions/<id>/shell`, which selects the Shell tab.
  - Tests: `npm test -- Disk`.
- **Desktop layout** (issue #514, ADR [0057](../docs/adr/0057-tauri-apps.md)). `AppEnv.wide` (`matchMedia("(min-width: 900px)")` in `main.tsx`, `FakeWidth` in tests) selects it. A narrow window keeps the phone layout.
  - `screens/Desktop.tsx` has the sidebar (the groups Needs you, Running and Done, each in the daemon order, with a status dot; ended sessions are at the end of Done; Mates, Approvals, Automations, Disk, Settings; the limits), the 40 px session bar (title, `where`, the tabs Chat and Changes, the Shell toggle and the `⋯` button) and the main column.
  - Shell is a bottom drawer (the `›_` button, Ctrl+` or Cmd/Ctrl+Shift+T). The browser is a side panel. It opens at `#/sessions/<id>/browser`, and one time for each session when a tool row of the agent runs `crew browser`. `#/sessions/<id>/editor` shows nvim ("Open in editor", Cmd/Ctrl+Shift+E) and `#/sessions/<id>/agent` shows the raw agent pane ("Show agent screen"). The `⋯` menu goes to these routes. Close goes back to `#/sessions/<id>`. `#/sessions/<id>/shell` opens the drawer.
  - `src/desktop.ts` holds the pure rules: `mainTabs` (a tab with `needs` is disabled with no session and tells why), `sidebarRows`, `nextNeeding`, `emptyMain` and `keyAction`.
  - To fill a tab, replace its entry in `panes` in `Desktop.tsx`. It gets the session, the snapshot, the client and the API.
  - The Browser tab (`screens/Browser.tsx`, [ADR 0059](../docs/adr/0059-tauri-browser-tab.md)) shows a page of the session in a sandboxed `iframe`. `src/browser.ts` holds the address rules (`browserAddress`, the same as `BrowserAddress` of the Mac app), the port links of the session worktrees (`portLinks`) and the tab label. Each session keeps its tabs while the app runs.
    - Each second, the pane gets `GET /api/v1/sessions/<id>/browser`. While the headless browser of the server has a tab for the session (`live`), the tab strip shows Server browser. It shows the last screenshot as an image. It is read-only.
    - Send cookies to the server takes a cookie file (Netscape `cookies.txt`, a JSON cookie list or a Playwright `storageState`) and posts its text to `POST /api/v1/browser/cookies`. Only the owner device can do this. The pane shows the count, or the error of the server.
    - In the desktop app (`env.desktop`), the bar has Open in app browser. It calls `crew_browser_open {session, url}`, with `null` for an empty tab. The app opens the window of the session that agents control (ADR 0060). An error of the command shows as an alert. The note says that an agent controls the app browser.
    - In the PWA, profiles and agent control of the tab are not available (see [ADR 0059](../docs/adr/0059-tauri-browser-tab.md)). Tests: `npm test -- Browser`.
  - Keys: the app shortcuts use Cmd on a Mac and Ctrl+Shift on Linux and Windows (`keyAction(e, mac)`, `modifierKeys`). Thus all plain Ctrl keys go to the terminal. The sidebar hints show the same keys. `keyAction` reads `e.code`, because Shift changes `e.key`.
    - Cmd or Ctrl+Shift with 1 to 9 selects a session, with N opens New session as a sheet (`#/new`), with T opens the Shell drawer and with E opens the editor.
    - Ctrl+Space on a Mac (Ctrl+Shift+Space on Linux and Windows) goes to the next session that needs you.
  - The main column is white (`--paper`) in Latte. Tests: `npm test -- Layout Sidebar`.
- **Terminal, Shell and nvim** (issue #517). `src/terminal.ts` has `TerminalStore`. `screens/Terminal.tsx` shows one of its terminals in a pane. `src/xterm.ts` is the xterm.js adapter (`AppEnv.terminal`; tests use `FakeTerminals` in `src/test/fake-terminal.ts`).
  - The store keeps one terminal and one socket for each session and kind (`agent`, `shell`, `nvim`). A change of tab or session moves the terminal element and does not close the socket. Thus the scrollback stays. The store removes the terminals of sessions that the stream does not show.
  - Terminal uses `session.Pane`. Shell and nvim call `POST …/shell` or `…/nvim` one time for each session, because `nvim.toggle` hides nvim on a second call. After a close with 4404, the next try calls it again.
  - The terminal fits its pane (`FitAddon` and a `ResizeObserver`) and sends `{"size"}` on each resize. Keys go to the pane, except keys with Cmd and the app shortcuts of `keyAction`. Ctrl+C, Ctrl+T, Ctrl+E, Ctrl+N, Ctrl+Space and Esc go to the pane.
  - The colors are the `--term-*` tokens (Mocha in both schemes).
  - On a phone, a session has the same tabs as the desktop: Chat, Terminal, Review, Shell and nvim (`screens/PhoneSession.tsx`).
  - `npm run fake` gives each session a demo pane. Tests: `npm test -- Terminal`.
- **Review tab** (issue #518). `screens/Review.tsx` is the same review as the Mac app. It uses the `review` routes of `crew serve` (see [internal/serve/](../internal/serve/AGENTS.md)).
  - `src/review.ts` holds the pure rules: `decodeReview` (Go nulls become empty lists), `reviewTree` (files by worktree, viewed when the blob did not change), `worktreeMenu`, `splitRows`, `segments` (the spans use byte offsets), `commentAnchor`, `commentedLines`, `draftRows` (`repo · path:lines`), `canSend` and `hunkOnly`.
  - Click `+` next to a line number to comment. Shift-click a second line to select a range.
  - Stage and revert send only the hunk. When git refuses the patch, the hunk shows the message of git and the review does not open again.
  - Tests: `npm test -- Review review`. They read the serve goldens `review-*.json`. One test decodes and renders a review of 50 files in less than 300 ms.
- **Session commands** (issue #519, redesign frames 2b and 2c). `screens/SessionCommands.tsx` shows the kit `Menu`: Rename…, Mute or Unmute, Model…, Effort…, Show agent screen, Open in editor, Open browser, Kill dev servers, Interrupt and End session…. An ended session has only Resume.
  - Show agent screen, Open in editor and Open browser go to `#/sessions/<id>/agent|editor|browser` (`/terminal` and `/nvim` stay as aliases) (`openSessionView` in `src/route.ts`). The shell selects that view from the route.
  - The dialogs use the kit `Dialog`. Interrupt asks first. A rename shows a `Toast` with Undo. `src/commands.ts` holds the pure rules (`commandItems`, `killedNote`) and the setting.
  - Open the menu with a right-click on a sidebar row, with the `⋯` button of the toolbar (desktop), or with the `⋯` button of the chat header (phone).
  - Model… and Effort… show the choices of the harness from `GET /api/v1/session-options`, then post `…/switch`. Kill dev servers posts `…/kill-dev-servers`. serve finds the process groups, so the app never sends one.
  - End session asks first while Settings has "Ask before I end a session" on (the default). The value is `crew.confirmEnd` in `localStorage` (`off` turns it off).
  - A failed command shows the message of the daemon in a `role="alert"` note. Tests: `npm test -- SessionCommands`.
- **Servers** (desktop app only, issue #522). `src/servers.ts` has the steps of the Add a server flow (the same as the Mac app), the SSH target check and `Servers`, which calls the `crew_server*` commands (see [desktop/](../desktop/AGENTS.md)).
  - The chip in the sidebar shows the current server. It is a kit Select button with a kit `Menu`. Its menu switches servers and has Add a server… and Manage servers…. A page of a remote server has no IPC, so it has no chip. The tray menu has Open This computer.
  - `#/servers` (`screens/Servers.tsx`) lists the servers with Open, Fix and Remove. You cannot remove This computer. A server that you added by its address has no Fix.
  - `#/servers/add` and the first start of the app show `screens/FirstRun.tsx` in a sheet (frames 6a and 6b): a centered flow with a progress bar of three parts. Where do agents run (This Mac or This computer, over SSH, a paired server), then the host fields, then the set up as a live checklist (it starts by itself, with Try again on a failure), then the first workspace with Skip and Open crew. For This computer, Browse… next to the workspace field opens the folder dialog. Only the first start shows Welcome. Open crew keeps the workspace in the New session choices (`rememberWorkspace` in `src/newsession.ts`), so it is the default project; `rememberedRoot` matches a `~/` path to its root.
  - On mobile, `AppEnv.connectUrl` (`window.__CREW_CONNECT_URL__`) adds Change server to Settings and to the pairing screen.
  - Tests: `npm test -- FirstRun Servers`.
- `src/screens/`: one component for each screen. `src/theme.css`: the Latte palette as CSS variables, and Mocha under `prefers-color-scheme: dark`, and IBM Plex Sans and JetBrains Mono from `@fontsource`.
- `src/test/`: test helpers (`FakeServer`, `MemoryStorage`, the Vitest setup). tdd-check treats them as port fakes.

## Tests

- Text colors must have a contrast of 4.5:1 or more on their background. Tap targets must be 44 px or more. `src/theme.test.ts` checks the token pairs and the `min-height` of the tappable classes. When you use a new pair or class, add it there.
- Test through the rendered screen with Testing Library (roles, labels, text), and through module inputs and outputs. Use `FakeServer` for the network. Never mock modules.
- For tdd-check, `*.test.ts(x)` files count as Go tests do. Commit them before the code. They must fail on base.

## Identity and new screens

- `Brand` shows the crew wordmark (`public/crew-wordmark.svg`, Mocha variant for dark) and the host. Session cards show the state glyphs of the Mac app (`stateStyle`).
- New session: Add workspace… (`POST /api/v1/workspaces`, `~` expands with `home` from `session-options`) and Remove workspace (with a confirmation, `POST /api/v1/workspaces/remove`).
- Automations: the last run outcome, History (`GET /api/v1/automations/runs`) and Run with context.
- A session whose tool rows run `crew browser` (or `crew browser`) shows a note that only the Mac app shows that browser.
- `scripts/web-screenshot` has a `scheme light|dark` step.
