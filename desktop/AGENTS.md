# desktop

The Tauri 2 app for desktop and mobile ([ADR 0057](../docs/adr/0057-tauri-apps.md)). The UI is the React app in [web/](../web/AGENTS.md). The repo-wide rules in the [root AGENTS.md](../AGENTS.md) also apply here, for example no comments and test first.

## Layout

- `src-tauri/`: the Rust crate `crew-desktop` (`Cargo.toml`, `tauri.conf.json`, `capabilities/`, `icons/`).
  - `src/lib.rs` opens the `main` window. On desktop, the window loads the URL in `CREW_URL`, else `http://127.0.0.1:7420/` (a local `crew serve`). Thus the UI and `/api/v1` have the same origin.
  - On mobile, the window loads the bundled web UI (`index.html` from `build.frontendDist`). The UI shows the pairing screen, not the desktop connection. `tests/start.rs` tests this rule.
  - `tauri.android.conf.json` sets `version` to `0.0.1`, because Android does not accept `0.0.0`.
  - `gen/android/` is the output of `npx tauri android init`, with the comments removed. The bundle id is `sh.giovani.crew`.
  - `build.frontendDist` points at `internal/serve/dist`. The window does not use it yet.
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
