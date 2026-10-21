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

  The connection banner (`Connection` in `screens/SessionList.tsx`) has these states, as in the Mac app: Connecting…; No crew daemon · retrying (close 1013, with the reason); Reconnecting in N s (other closes); Build mismatch · stopped (close 4502, no retry, with Reconnect). In the desktop app (`AppEnv.desktopFix`, see `src/desktop-host.ts`), the retrying states show Fix instead of Retry now. Fix shows Fixing the daemon, then connects again. A failed Fix shows Fix failed · retrying with the reason. `AppEnv.desktopProblem` (the app could not start `crew serve`) shows `DesktopProblem` with Fix. Tests: `npm test -- Connection`.

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
  - The header shows the name, `where`, harness and model, context left and a state chip. While the session runs or asks permission, it also shows Interrupt, behind a confirmation.
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
  - `#/new` is the new session form (`screens/NewSession.tsx`). Its fields are workspace, task (optional), first prompt, agent, model and effort. After 350 ms, the form checks the work item through `/work-items/resolve`. It keeps the choices in `crew.new` in `localStorage`. The default workspace is the last one that the daemon used. A launch error, also the output of a setup recipe, shows in the form. A success opens `#/sessions/<id>`.
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
- **Faces.** `src/faces.ts` has the 12 faces of the design (`FACES`: id, name, accent for light and dark, the SVG parts and the 2-line TUI glyph), `faceSvg` and `faceGlyph`. The TUI and the Mac app use the same rules:
  - The face of a mate is its `avatar` (from the stream row, else from `GET /api/v1/mates`) if that is a face id. Else it is the face with the id of the mate name. Else it is `FACES[sum of the UTF-8 bytes of the name % 12]`. The color is the `color` of the mate, else the accent of the face.
  - `faceState`: `paused` if the mate is paused or a guard holds it. Else `needs` if the mate has a pending approval, or a thread or conversation that is not ended waits or asks for permission. Else `working` if one runs. Else `idle`.
  - The tone axes and their sentences come from the server (`tones` of `GET /api/v1/mates`). The app keeps no copy of the sentences. `toneLines` gives the sentences of the chosen steps, and `toneOf` gives the `tone` that the app sends (`{key: step}`, 1 to 5). The server adds the sentences to the system prompt, so the prompt text stays clean.
- `#/mates` (`screens/Mates.tsx`) shows a card for each mate of the stream: the face with its state, the name, the first line of the prompt and the state word. A card opens `#/mates/<name>`. The page also has `+` (to `#/mates/new`), the kill switch and the pending approvals ("Needs you", the same cards as `#/approvals`).
  - The kill switch: Stop all mates asks first, then posts `/api/v1/mates/stop` `{"stop":true}`. While the stream says `stopped`, the page shows Start all mates, and the session list shows "All mates are stopped".
- `#/mates/<name>` is the profile: the big face, the prompt, tags for agent, model, effort and repos, and these parts:
  - "+ New conversation" posts `/api/v1/mates/<name>/new` and opens the new session.
  - Conversations: the local `conversations` of the stream (`session`, `name`, `state`, `ended`, `started_at`), then the Slack threads (each with a Slack link).
  - Memory: `GET …/memory`. Edit memory opens a text box, and Save memory posts `{"text"}`. Empty text clears it.
  - Pause or Resume (`POST …/pause|resume`) and Settings (agent, model, effort, repos, prompt, posted to `/api/v1/mates`).
  - "Connect to Slack…" with the Slack mark, only while the state is `ready` or `no_tokens`. It shows the manifest link (`GET …/setup`), takes the two tokens (`POST …/tokens`) and shows the claim code (`POST …/claim`). Slack is optional.
- `#/mates/new` makes a mate in three steps: 1 face, color and name (as in the Mac app, a name that is not a handle or that a mate has already disables Next); 2 the prompt, presets and the tone sliders (from `tones`), with the "Added to the prompt" box; 3 agent, model, effort and repos. Create posts `/api/v1/mates` with `avatar`, `color`, `tone` and `enabled: true`, then opens the profile.
- A session of a mate (`Mate.Name` in the stream) shows a bar over the chat header: the face, the name and the state, and Start fresh. Start fresh posts `/api/v1/sessions/{id}/fresh` (`mate.fresh`) and opens the new session. The daemon asks the old session for a handoff to the memory. "Keep this worktree" is on by default (`same_worktree`). The old session continues.
- The chat of a mate session is the Chat view of the Mac app. Each reply of the agent shows the face of the mate (28 px, with its state) and its name with a capital first letter, in a bubble (`.msg-mate`). The composer says "Message <Name>…". A session of no mate shows no face.
  - A session that Start fresh made has `Mate.FreshFrom` (the old session id). The chat loads the newest page of the old session one time. It shows those messages above a dashed divider "Earlier conversation ended · handoff saved to memory", the same as the Mac app. A session with no `FreshFrom` shows no divider.
- Tests: `npm test -- Mates faces`.
- `#/approvals` (`screens/Approvals.tsx`) shows a card for each pending approval of a mate (`GET /api/v1/approvals`): the mate, the action, who asked, the tool, the exact input, the time until it expires and a link to the session. Approve and Deny post `/api/v1/approvals/<id>/approve|deny`, then the card shows the result. A 409 `stale` or a `not_found` shows "This approval is gone". The push of an approval opens this screen. Tests: `npm test -- Approvals`.
- `#/settings` (`screens/Settings.tsx`) shows Settings (issue #521). A tab bar under the session list and Settings switches between them. On the desktop layout, the Settings link of the sidebar opens it in the main column. The left list has two groups:
  - This app: General (the server, this device, Enable notifications, the General options, Sign out), Notifications (the alerts for each state), Appearance and Shortcuts. The app keeps them in `crew.settings` in `localStorage` (`src/settings.ts`). The Theme option sets `data-theme` on `<html>`, and `theme.css` has a palette for each value.
  - Server (`screens/ServerSettings.tsx`): Workspaces (the path field shows the folders of `GET /workspaces/dirs`), Agents (hooks, default model and effort, `fallback.threshold`, nvim), Notifications (`push.away_after`, the devices with Revoke, Pair a device) and Appearance (the `[theme]` colours).
  - A server group that gets `unknown_method` shows a note that the server does not have this setting. A group that gets `forbidden` shows a note that only the owner device can change it.
  - `src/shortcuts.ts` has the shortcut rules of the Mac app: a combo needs Cmd or Ctrl, Cmd or Ctrl with 1 to 9 is for the session jumps, a combo cannot have two actions, and the fixed combos (Cmd+, and the review keys) stay. Tests: `npm test -- Settings Shortcuts`.
- **Desktop layout** (issue #514, ADR [0057](../docs/adr/0057-tauri-apps.md)). `AppEnv.wide` (`matchMedia("(min-width: 900px)")` in `main.tsx`, `FakeWidth` in tests) selects it. A narrow window keeps the phone layout.
  - `screens/Desktop.tsx` has the sidebar (sessions in the daemon order, `order` when the stream has it, else the sessions that need you first; an Ended group; Mates, Approvals, Automations, Settings; the limits), the toolbar (the tabs Chat, Terminal, Review, Shell and nvim) and the main column.
  - `src/desktop.ts` holds the pure rules: `mainTabs` (a tab with `needs` is disabled with no session and tells why), `sidebarRows`, `nextNeeding`, `emptyMain` and `keyAction`.
  - To fill a tab, replace its entry in `panes` in `Desktop.tsx`. It gets the session, the snapshot, the client and the API.
  - Keys: the app shortcuts use Cmd on a Mac and Ctrl+Shift on Linux and Windows (`keyAction(e, mac)`, `modifierKeys`). Thus all plain Ctrl keys go to the terminal. The sidebar hints show the same keys. `keyAction` reads `e.code`, because Shift changes `e.key`.
    - Cmd or Ctrl+Shift with 1 to 9 selects a session, with N opens New session as a sheet (`#/new`), with T opens Shell and with E opens nvim.
    - Ctrl+Space on a Mac (Ctrl+Shift+Space on Linux and Windows) goes to the next session that needs you.
  - The main column is white (`--paper`) in Latte. Tests: `npm test -- Layout Sidebar`.
- **Terminal, Shell and nvim** (issue #517). `src/terminal.ts` has `TerminalStore`. `screens/Terminal.tsx` shows one of its terminals in a pane. `src/xterm.ts` is the xterm.js adapter (`AppEnv.terminal`; tests use `FakeTerminals` in `src/test/fake-terminal.ts`).
  - The store keeps one terminal and one socket for each session and kind (`agent`, `shell`, `nvim`). A change of tab or session moves the terminal element and does not close the socket. Thus the scrollback stays. The store removes the terminals of sessions that the stream does not show.
  - Terminal uses `session.Pane`. Shell and nvim call `POST …/shell` or `…/nvim` one time for each session, because `nvim.toggle` hides nvim on a second call. After a close with 4404, the next try calls it again.
  - The terminal fits its pane (`FitAddon` and a `ResizeObserver`) and sends `{"size"}` on each resize. Keys go to the pane, except keys with Cmd and the app shortcuts of `keyAction`. Ctrl+C, Ctrl+T, Ctrl+E, Ctrl+N, Ctrl+Space and Esc go to the pane.
  - The colors are the `--term-*` tokens (Mocha in both schemes).
  - On a phone, a session has the same tabs as the desktop: Chat, Terminal, Review, Shell and nvim (`screens/PhoneSession.tsx`).
  - `npm run fake` gives each session a demo pane. Tests: `npm test -- Terminal`.
- **Review tab** (issue #518). `screens/Review.tsx` is the same review as the Mac app and the TUI. It uses the `review` routes of `crew serve` (see [internal/serve/](../internal/serve/AGENTS.md)).
  - `src/review.ts` holds the pure rules: `decodeReview` (Go nulls become empty lists), `reviewTree` (files by worktree, viewed when the blob did not change), `worktreeMenu`, `splitRows`, `segments` (the spans use byte offsets), `commentAnchor`, `commentedLines`, `draftRows` (`repo · path:lines`), `canSend` and `hunkOnly`.
  - Click `+` next to a line number to comment. Shift-click a second line to select a range.
  - Stage and revert send only the hunk. When git refuses the patch, the hunk shows the message of git and the review does not open again.
  - Tests: `npm test -- Review review`. They read the serve goldens `review-*.json`. One test decodes and renders a review of 50 files in less than 300 ms.
- **Session commands** (issue #519). `screens/SessionCommands.tsx` has the commands of the sidebar menu of the Mac app: Rename…, Mute or Unmute, Model…, Effort…, Kill dev servers and End session…. An ended session has only Resume. `src/commands.ts` holds the pure rules (`commandItems`, `killedNote`) and the setting.
  - Open the menu with a right-click on a sidebar row, with the `⋯` button of the toolbar (desktop), or with the `⋯` button of the chat header (phone).
  - Model… and Effort… show the choices of the harness from `GET /api/v1/session-options`, then post `…/switch`. Kill dev servers posts `…/kill-dev-servers`. serve finds the process groups, so the app never sends one.
  - End session asks first while Settings has "Ask before I end a session" on (the default). The value is `crew.confirmEnd` in `localStorage` (`off` turns it off).
  - A failed command shows the message of the daemon in a `role="alert"` note. Tests: `npm test -- SessionCommands`.
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
