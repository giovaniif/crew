# desktop

The Tauri 2 app for desktop and mobile ([ADR 0057](../docs/adr/0057-tauri-apps.md)). The UI is the React app in [web/](../web/AGENTS.md). The repo-wide rules in the [root AGENTS.md](../AGENTS.md) also apply here, for example no comments and test first.

## Layout

- `src-tauri/`: the Rust crate `crew-desktop` (`Cargo.toml`, `tauri.conf.json`, `capabilities/`, `icons/`).
  - `src/lib.rs` opens the `main` window. If `CREW_URL` is set, the window loads it. Thus the UI and `/api/v1` have the same origin.
  - Else the app starts its own `crew serve` (`src/local.rs`):
    1. It uses the `crew` binary next to the app binary (the bundle), else the first `crew` on `PATH`.
    2. It runs `crew serve --addr 127.0.0.1:<port> --url http://127.0.0.1:<port>` on a free port and waits for `/api/v1/hello`.
    3. It uses the token in `auth.json` in the app data directory (600) if the token works. Else it gets a code from `crew remote pair --json --name desktop`, pairs with `POST /api/v1/pair` and writes `auth.json`.
    4. It gives the login to the page as `window.__CREW_DESKTOP_AUTH__` (an initialization script). The web app uses it as `AppEnv.desktopAuth` and does not write it to `localStorage`. Thus the app shows no Install or Pair screen.
    5. It stops `crew serve` when it quits. On Linux, `crew serve` also gets `SIGTERM` when the app process stops (`PR_SET_PDEATHSIG`).
- Attention (`src/attention.rs`, the same behavior as the Mac app):
  - The web app finds `window.__TAURI_INTERNALS__` and calls two commands. `crew_notify {banner}` posts a banner with the notification plugin. `crew_attention {menu}` makes the tray menu again and sets the badge.
  - The tray menu shows Needs you, Done · unread, Working, the quota meters, New session…, Open crew and Quit crew. A session item opens `#/sessions/<id>` in the window.
  - The badge is the number of sessions that need you (`set_badge_count`: the macOS Dock and Linux Unity launchers). At 0 there is no badge.
  - `build.rs` declares the commands (`AppManifest`). `capabilities/default.json` has no remote origins. It gives `core:default` and `fix_daemon` only to the bundled page. Each time the app opens a window on `crew serve`, `src/ipc.rs` adds a capability that allows `crew_notify`, `crew_attention` and `fix_daemon` to the windows `main` and `main-*` only for the exact origin of `crew serve` (`http://127.0.0.1:<port>` or `http://localhost:<port>`). Thus a dev server in the Browser tab gets no IPC ([ADR 0059](../docs/adr/0059-tauri-browser-tab.md)). A different `CREW_URL` origin gets no tray or banners. `tests/ipc.rs` tests these rules.
  - The rules (which banners, the settings, the menu rows) are in `web/src/desktopAttention.ts` (see [web/](../web/AGENTS.md)). `tests/attention.rs` tests the menu entries, their actions and the badge.
  - If there is no `crew` or `crew serve` does not start, the window loads the bundled page (`connect/index.html`) with `window.__CREW_DESKTOP_PROBLEM__` (the reason). The page then shows "crew did not start", the reason and Fix, not the connect form.
  - Fix is the Tauri command `fix_daemon` (declared in `build.rs`, allowed for the bundled page in `capabilities/default.json` and for the origin of `crew serve` by `src/ipc.rs`). It runs `crew setup daemon`, then `crew setup daemon --check` (`local::fix_daemon`). A failed setup or a `failing` check returns the `reason` of the check, else the error output of the setup. Then it starts `crew serve` again if it is not alive (on the same port), or, after a failed start, starts and pairs a new one and opens a new window (`main-<n>`). The web app calls it from the connection banner (see [web/](../web/AGENTS.md)).
  - With `CREW_URL`, Fix runs only `crew setup daemon` on this computer. On the page of an SSH server, Fix runs `crew setup daemon` on that host (`Hub::fix_target`) and opens its tunnel again.
  - `cargo test --manifest-path desktop/src-tauri/Cargo.toml` runs `tests/local.rs` (the port choice, the `crew` lookup and the `serve` arguments) and `tests/fix.rs` (Fix with a fake `crew` script, Unix only).
- Servers (`src/servers.rs`, `src/hub.rs`, the same list as the Mac app, issue #522):
  - `servers.json` in the app data directory (600, written to a temporary file and then renamed) keeps the servers, the selected server and the login of each remote server. This computer is always in the list and you cannot remove it. Its login stays in `auth.json`.
  - There are three kinds: `local` (the `crew serve` that the app starts), `url` (a remote `crew serve`, paired with its address and a code) and `ssh` (a host from `~/.ssh/config`).
  - An `ssh` server: the app runs `crew setup daemon` and `crew setup daemon --check` on the host. Then it opens a tunnel, `ssh -L <port>:127.0.0.1:<port> <host> crew serve --addr 127.0.0.1:<port> --url http://127.0.0.1:<port>`. Then it gets a code from `crew remote pair --json` on the host and pairs through the tunnel.
  - Each `ssh` command uses `-T -o BatchMode=yes -o RemoteCommand=none -o RequestTTY=no -o ConnectTimeout=10 -- <host>`. The app refuses a target that starts with `-` or has spaces or quotes. `ssh_hosts` lists the `Host` names that have no `*`, `?` or `!`.
  - A `url` server: Rust pairs with `POST /api/v1/pair` (`ureq`, desktop only).
  - To open a server, the app opens a new window on its page (`open_window`) with its login in `window.__CREW_DESKTOP_AUTH__`.
  - Security: a remote server controls the page that it serves. Thus a page of a `url` server gets no IPC. A page of an SSH tunnel gets only `fix_daemon` (`ipc::tunnel_capability`), which then runs the SSH setup on that host. Only the exact origin of the local `crew serve` gets the server commands (`ipc::server_capability`). Each server command also checks the page origin (`Hub::trusted`). `tests/ipc.rs` tests that a remote page gets no server command.
  - The tray menu has Open This computer, the way back from a remote server.
  - The commands are `crew_servers`, `crew_ssh_hosts`, `crew_server_add`, `crew_server_open`, `crew_server_remove`, `crew_server_fix` and `crew_server_workspace`. `crew_server_fix` runs Fix on this computer or `crew setup daemon` over SSH. A `url` server has no Fix, because the app has no SSH access to it.
  - When the app starts, it opens this computer. If a different server is selected, it then connects to that server and opens it.
  - The first start (no `servers.json`) sets `first_run`. The web app then shows the Add a server flow (see [web/](../web/AGENTS.md)).
  - `tests/servers.rs` tests the store, the SSH command lines, the hosts, the target check, the check output and the target of Fix.
  - On mobile, the window loads the bundled connect page (`build.frontendDist` is `../connect`). `tests/start.rs` tests that mobile opens the bundled page. The user types the address of a remote `crew serve`. The page keeps it and opens it. Then the pairing of the PWA starts ([ADR 0046](../docs/adr/0046-remote-app.md)).
  - The connect page keeps a list of servers in `crew.servers` (`localStorage`). It copies the old `crew.server` one time. When it starts, it opens the server that you used last. With `?change`, it shows the list with Open and Remove, and the form to add a server.
  - The mobile window gets `window.__CREW_CONNECT_URL__` (an initialization script): `tauri://localhost/index.html?change` on iOS, `http://tauri.localhost/index.html?change` on Android. The web app shows Change server in Settings and on the pairing screen when this value is set.
  - `Info.ios.plist` sets `ITSAppUsesNonExemptEncryption` to `false`. Thus TestFlight does not stop the build for export compliance.
  - `gen/apple/` is the Xcode project from `npx tauri ios init`. Its app icons come from `npx tauri icon ../macos/AppIcon.png --ios-color '#ffffff'`. App Store Connect refuses an icon with an alpha channel, so the icons have a white background and no alpha.
  - `tauri.android.conf.json` sets `version` to `0.0.1`, because Android does not accept `0.0.0`.
  - `gen/android/` is the output of `npx tauri android init`, with the comments removed. The bundle id is `sh.giovani.crew`.
  - The icons come from `macos/AppIcon.png`. Run `npx tauri icon ../macos/AppIcon.png -o src-tauri/icons` to make them again. Keep only the desktop files.
- Update (`src/update.rs`, desktop only):
  - At launch and each 6 h, the app gets `latest.json` from the `updater` branch (`plugins.updater.endpoints` in `tauri.conf.json`). The release workflow writes this file for each tag, also for a prerelease. Thus the app also offers `v0.1.0-beta.*` releases.
  - `newer` compares the versions as semver, with prereleases (`0.1.0-beta.2` < `0.1.0-beta.10` < `0.1.0`).
  - If a newer version is available, the app shows a dialog (`prompt`). It installs only when the user selects Install and restart. Then it stops `crew serve`, runs `crew daemon stop` and restarts. The bundle has `crew`, so the update replaces `crew` together with the app. The new `crew` starts a new daemon.
  - Debug builds and `CREW_NO_UPDATE_CHECK=1` do not check.
  - `tests/update.rs` tests the version compare, the prompt and the steps after the answer.
  - The public key is `plugins.updater.pubkey`. The private key and its password are the repo secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Do not put them in the repo.
  - The Windows build removes the prerelease part from its version, because the MSI does not accept it. Thus Windows does not get a prerelease update of the same core version.
- `connect/`: the connect page (`index.html`, `server.js`) and its test (`node --test desktop/connect/server.test.mjs`).
- `package.json`: the Tauri CLI (`npx tauri`).
- `e2e/`: the WebDriver tests (`*.test.mjs`, `node --test`) and `e2e/run`.

## Commands

- Linux needs the Tauri system libraries one time: `sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`.
- The e2e tests also need `webkit2gtk-driver`, `xvfb` and `cargo install tauri-driver --locked`.
- `cargo build --manifest-path desktop/src-tauri/Cargo.toml` makes `desktop/src-tauri/target/debug/crew-desktop`.
- `npm ci` in `desktop/`, then `npx tauri build` makes the packages.
- `xvfb-run -a desktop/e2e/run` runs the e2e tests on Linux. It needs `npm ci` in `web/` and the debug build.
  - It builds `crew` from this checkout into a temporary `PATH` directory. Run `make web` first, so that `crew serve` has the UI.
  - `session-list.test.mjs` uses the fake API of `web/` (`CREW_FAKE_API=1`) on `127.0.0.1:5179` (`CREW_E2E_PORT`) through `CREW_URL`. It also calls `crew_attention` and `crew_notify` from the page.
  - `local-serve.test.mjs` runs without `CREW_URL`. The app starts and pairs its own `crew serve`. After the test, `run` checks that no `crew serve` continues to run.
  - Each test file gets its own `tauri-driver` on port 4444, because the app gets its environment from `tauri-driver`.
  - `CREW_E2E_SHOTS=<dir>` writes a screenshot of the local session list to `<dir>/local-serve.png`.
  - It sets a temporary `CREW_HOME`, `CREW_TMUX_SOCKET` and `HOME`. Thus the real `~/.claude`, `~/.codex` and `~/.crew` do not change.
  - `CREW_E2E_APP` selects a different app binary.
- `tauri-driver` has no macOS driver. CI builds the app on macOS, but runs the e2e tests only on Linux.

## Android

- The build needs a full JDK 17 or 21 (a JRE is not sufficient, because Gradle compiles Java), the Android SDK (`platform-tools`, a platform, `build-tools`), the NDK and the four Rust Android targets. You can install all of them in your home directory. You do not need root.
  - Get the command-line tools from developer.android.com into `~/Android/Sdk/cmdline-tools/latest`.
  - Run `sdkmanager --licenses`, then `sdkmanager` with the packages `platform-tools`, `platforms;android-34`, `build-tools;34.0.0` and `ndk;27.0.12077973`. Gradle downloads a newer platform when the project needs it.
  - Run `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`.
  - You can extract a Temurin JDK into `~/.local/jdk` and set `JAVA_HOME` to it.
  - Set `ANDROID_HOME=~/Android/Sdk` and `NDK_HOME=~/Android/Sdk/ndk/27.0.12077973`.
- `make web`, then `npm ci` and `npx tauri android build --debug --apk` in `desktop/` make `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`.
- `desktop/android-smoke [apk]` installs the APK on the device or emulator that `adb` sees, starts the app and makes sure that it does not stop. An x86_64 emulator needs KVM: your user must be able to open `/dev/kvm` (the `kvm` group).
- `cargo test --manifest-path desktop/src-tauri/Cargo.toml` runs the Rust tests.

## CI

The `desktop` job (`ubuntu-latest`) builds the app, runs the Rust tests and runs `desktop/e2e/run`. The `android` job (`ubuntu-latest`) builds the debug APK, uploads it as the `crew-android-debug` artifact and runs `desktop/android-smoke` on an API 34 emulator. The `desktop-macos` job (`macos-15`) builds the app only.

The `ios` workflow (`.github/workflows/ios.yml`, `macos-15`) builds the iOS app:

- On a pull request, it makes a simulator build with no signature: `npx tauri ios build --debug --target aarch64-sim` (in `desktop/`, macOS). It needs no secrets.
- It selects the latest stable Xcode, because App Store Connect needs the iOS 26 SDK.
- On a push to `main` and on `workflow_dispatch`, it makes a signed App Store build and sends it to TestFlight with `xcrun altool --upload-app`.
  - Signing is automatic. It uses the App Store Connect API key in the repo secrets `APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_KEY_P8` and `APPLE_TEAM_ID`.
  - The build number is the run number of the workflow. Thus each upload has a larger number.
- Each run makes sure that the built app has `ITSAppUsesNonExemptEncryption` set to `false`.

The `desktop` job of `release.yml` makes the packages for each tag, on `workflow_dispatch` (a dry run) and on a pull request that changes `desktop/`:

- macOS arm64 and amd64 (`.dmg`), Linux amd64 (`.deb`, `.AppImage`) and Windows x64 (`.msi`, `.exe`).
- It puts the goreleaser `crew` of the platform in the bundle as a Tauri `externalBin` (`binaries/crew-<target>`). Thus `crew` is next to the app binary. `mainBinaryName` is `crew-desktop`, so that the two names are different. Windows has no `crew` build.
- It sets the version from the tag with `--config`.
- On macOS, it signs and notarizes the app when the `APPLE_*` secrets exist. It writes `APPLE_API_KEY_P8` to a temporary `AuthKey.p8` for `APPLE_API_KEY_PATH`. Without the secrets, the build is not signed.
- It runs `crew version` from each macOS and Linux package and compares the tag. It uploads the packages to the release only for a tag.
- When the `TAURI_SIGNING_PRIVATE_KEY` secret exists, it sets `bundle.createUpdaterArtifacts` and signs the update bundles (`.app.tar.gz`, `.AppImage`, `.deb`, `.msi`, `.exe`, each with a `.sig`). A tag build without the secret fails.
- The `updater` job makes `latest.json` from the signatures, verifies each signature with `minisign` and the public key, and uploads `latest.json` as the `latest-json` artifact. For a tag, it also uploads `latest.json` to the release and force-pushes it to the `updater` branch.
