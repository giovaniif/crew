# desktop

The Tauri 2 app for desktop and mobile ([ADR 0057](../docs/adr/0057-tauri-apps.md)). The UI is the React app in [web/](../web/AGENTS.md). The repo-wide rules in the [root AGENTS.md](../AGENTS.md) also apply here, for example no comments and test first.

## Layout

- `src-tauri/`: the Rust crate `crew-desktop` (`Cargo.toml`, `tauri.conf.json`, `capabilities/`, `icons/`).
  - `src/lib.rs` opens the `main` window. The window loads the URL in `CREW_URL`, else `http://127.0.0.1:7420/` (a local `crew serve`). Thus the UI and `/api/v1` have the same origin.
  - On mobile, the window loads the bundled connect page (`build.frontendDist` is `../connect`). The user types the address of a remote `crew serve`. The page keeps it and opens it. Then the pairing of the PWA starts ([ADR 0046](../docs/adr/0046-remote-app.md)).
  - `Info.ios.plist` sets `ITSAppUsesNonExemptEncryption` to `false`. Thus TestFlight does not stop the build for export compliance.
  - `gen/apple/` is the Xcode project from `npx tauri ios init`. Its app icons come from `npx tauri icon ../macos/AppIcon.png --ios-color '#ffffff'`. App Store Connect refuses an icon with an alpha channel, so the icons have a white background and no alpha.
- `connect/`: the connect page (`index.html`, `server.js`) and its test (`node --test desktop/connect/server.test.mjs`).
  - The icons come from `macos/AppIcon.png`. Run `npx tauri icon ../macos/AppIcon.png -o src-tauri/icons` to make them again. Keep only the desktop files.
- `package.json`: the Tauri CLI (`npx tauri`).
- `e2e/`: the WebDriver tests (`*.test.mjs`, `node --test`) and `e2e/run`.

## Commands

- Linux needs the Tauri system libraries one time: `sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`.
- The e2e tests also need `webkit2gtk-driver`, `xvfb` and `cargo install tauri-driver --locked`.
- `cargo build --manifest-path desktop/src-tauri/Cargo.toml` makes `desktop/src-tauri/target/debug/crew-desktop`.
- `npm ci` in `desktop/`, then `npx tauri build` makes the packages.
- `xvfb-run -a desktop/e2e/run` runs the e2e tests on Linux. It needs `npm ci` in `web/` and the debug build.
  - It starts the fake API of `web/` (`CREW_FAKE_API=1`) on `127.0.0.1:5179` (`CREW_E2E_PORT`) and `tauri-driver` on port 4444.
  - It sets a temporary `CREW_HOME`, `CREW_TMUX_SOCKET` and `HOME`. Thus the real `~/.claude`, `~/.codex` and `~/.crew` do not change.
  - `CREW_E2E_APP` selects a different app binary.
- `tauri-driver` has no macOS driver. CI builds the app on macOS, but runs the e2e tests only on Linux.

## CI

The `desktop` job (`ubuntu-latest`) builds the app and runs `desktop/e2e/run`. The `desktop-macos` job (`macos-15`) builds the app only.

The `ios` workflow (`.github/workflows/ios.yml`, `macos-15`) builds the iOS app:

- On a pull request, it makes a simulator build with no signature: `npx tauri ios build --debug --target aarch64-sim` (in `desktop/`, macOS). It needs no secrets.
- It selects the latest stable Xcode, because App Store Connect needs the iOS 26 SDK.
- On a push to `main` and on `workflow_dispatch`, it makes a signed App Store build and sends it to TestFlight with `xcrun altool --upload-app`.
  - Signing is automatic. It uses the App Store Connect API key in the repo secrets `APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_KEY_P8` and `APPLE_TEAM_ID`.
  - The build number is the run number of the workflow. Thus each upload has a larger number.
- Each run makes sure that the built app has `ITSAppUsesNonExemptEncryption` set to `false`.
