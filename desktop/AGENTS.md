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
  - If there is no `crew` or `crew serve` does not start, the window loads `http://127.0.0.1:7420/`.
  - `cargo test --manifest-path desktop/src-tauri/Cargo.toml` runs `tests/local.rs`: the port choice, the `crew` lookup and the `serve` arguments.
  - On mobile, the window loads the bundled web UI (`index.html` from `build.frontendDist`). The app does not start `crew serve`. The UI shows the pairing screen, not the desktop connection. `tests/start.rs` tests this rule.
  - `tauri.android.conf.json` sets `version` to `0.0.1`, because Android does not accept `0.0.0`.
  - `gen/android/` is the output of `npx tauri android init`, with the comments removed. The bundle id is `sh.giovani.crew`.
  - `build.frontendDist` points at `internal/serve/dist`. Only the mobile window uses it.
  - The icons come from `macos/AppIcon.png`. Run `npx tauri icon ../macos/AppIcon.png -o src-tauri/icons` to make them again. Keep only the desktop files.
- `package.json`: the Tauri CLI (`npx tauri`).
- `e2e/`: the WebDriver tests (`*.test.mjs`, `node --test`) and `e2e/run`.

## Commands

- Linux needs the Tauri system libraries one time: `sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`.
- The e2e tests also need `webkit2gtk-driver`, `xvfb` and `cargo install tauri-driver --locked`.
- `cargo build --manifest-path desktop/src-tauri/Cargo.toml` makes `desktop/src-tauri/target/debug/crew-desktop`.
- `npm ci` in `desktop/`, then `npx tauri build` makes the packages.
- `xvfb-run -a desktop/e2e/run` runs the e2e tests on Linux. It needs `npm ci` in `web/` and the debug build.
  - It builds `crew` from this checkout into a temporary `PATH` directory. Run `make web` first, so that `crew serve` has the UI.
  - `session-list.test.mjs` uses the fake API of `web/` (`CREW_FAKE_API=1`) on `127.0.0.1:5179` (`CREW_E2E_PORT`) through `CREW_URL`.
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
