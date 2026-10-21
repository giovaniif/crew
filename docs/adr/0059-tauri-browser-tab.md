# ADR 0059: The Browser tab in the Tauri app

Status: accepted, 2026-10-20. Issue #526. This ADR changes the UI part of [ADR 0051](0051-browser-in-mac-app.md) for the Tauri app of [ADR 0057](0057-tauri-apps.md).

## Context

The SwiftUI app has a Browser tab ([ADR 0051](0051-browser-in-mac-app.md)). It works as follows:

- Each session has a `BrowserPage` with its own tabs. Each tab is a `WKWebView`.
- The address bar uses the rules of `BrowserAddress` (`macos/Sources/CrewKit/Browser.swift`):
  - A port (`3000` or `:3000`) becomes `http://<host>:<port>/`.
  - `localhost`, `127.0.0.1` and `0.0.0.0` become the server host. The port and the path stay.
  - A URL with `http` or `https` stays. Other schemes are refused.
  - A name with a dot gets `https://`. Text with spaces is refused.
- The host is `localhost` for this Mac, or the SSH host of the server.
- Above the page, the tab shows a link for each TCP port that a process in a session worktree listens on (`BrowserLinks`).
- Profiles keep cookies apart. You can import cookies from a different browser and send them to the server.
- An agent controls the tab through `browser.attach`. When there is no app, the server runs a headless browser, and the tab shows its frames ([ADR 0054](0054-headless-browser-fallback.md)).

The Tauri app shows the UI of `web/` in one webview. That webview loads `crew serve`. It has Tauri IPC: the commands `crew_notify`, `crew_attention` and `fix_daemon`. Before this ADR, `capabilities/default.json` gave IPC to each origin `http://127.0.0.1:*` and `http://localhost:*`. A dev server of a session also has such an origin. Thus a page that an agent makes could call the Tauri commands. This is not safe.

## Decision

### The page

- The Browser tab is a tab of the toolbar of the desktop layout (`web/src/screens/Desktop.tsx`, `panes`).
- The page of a tab is an `iframe` in the pane. We do not use a second Tauri webview:
  - A child webview needs the `unstable` feature of Tauri. It is a native view above the DOM, so the app must move it each time the layout changes.
  - The `iframe` works the same in the Tauri app and in the PWA.
- The rules of `BrowserAddress` and `BrowserLinks` are in `web/src/browser.ts`, with tests. The host is the host of the page that shows the UI (`location.hostname`).
- Each session has its own tabs. A new tab opens on the first port of the session, if there is one.
- Each tab has a link "Open in browser". It opens the page in the system browser.

### Limits of the iframe

- A page that sends `X-Frame-Options` or `frame-ancestors` does not show in the iframe. Use "Open in browser" for it.
- When the UI uses `https` and the dev server uses `http`, the webview blocks the page (mixed content). Use "Open in browser".
- The UI cannot read the URL or the title of a cross-origin page. Thus the address bar shows the URL that you typed, not the URL after a click in the page.
- The iframe has the `sandbox` attribute with `allow-scripts`, `allow-forms`, `allow-same-origin`, `allow-popups` and `allow-modals`. It does not have `allow-top-navigation`. Thus the page cannot replace the UI.

### IPC only for the origin of crew serve

- `capabilities/default.json` has no `remote` URLs. It gives `core:default` and `fix_daemon` only to the bundled page.
- Each time the app opens a window on `crew serve`, it adds a capability at run time (`ipc::serve_capability`, `src/ipc.rs`). It gives `crew_notify`, `crew_attention`, `fix_daemon` and `core:default` to the windows `main` and `main-*` for one origin: the exact origin of `crew serve`, for example `http://127.0.0.1:53412`.
- The app adds this capability only for an `http` origin on `127.0.0.1` or `localhost` with a port. A different `CREW_URL` origin gets no IPC, as before.
- Thus a dev server on a different port gets no IPC in an iframe or in a different window. `tests/ipc.rs` tests these rules.

### Not available yet

- Profiles, cookie import and "Send cookies to the server" need a webview that the app controls. The tab shows a note that they are not available yet.
- Agent control through `browser.attach` and the headless frames of the server need routes in `crew serve`. `crew serve` does not have them yet. The tab shows a note. Until then, an agent uses the headless browser of the server.

### The phone

- The phone layout has no Browser tab. A phone screen is too small for a page in a pane, and the dev server is often not on a host that the phone can open.
- The note of a session that uses the browser stays (`BrowserNote`).

## Consequences

- The Browser tab works in the Tauri app and in the PWA with the same code.
- Some pages do not show in the iframe. "Open in browser" is the alternative.
- A page in the Browser tab cannot call the Tauri commands.
- Profiles, cookies, agent control and the headless view need more work in `crew serve` and in the app.
