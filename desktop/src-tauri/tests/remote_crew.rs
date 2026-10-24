#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, MutexGuard};

use crew_desktop::hub::{ssh_crew, ssh_install, ssh_pair_code};
use crew_desktop::servers::{plan, Plan};

static SERIAL: Mutex<()> = Mutex::new(());

const APP: &str = "0.1.0-beta.6";

struct Box {
    root: PathBuf,
    log: PathBuf,
}

fn crew_script(version: &str, log: &Path, pairs: bool) -> String {
    let pair = if pairs {
        "  echo '{\"code\":\"ABCD2345\"}'\n  exit 0\n".to_string()
    } else {
        "  echo 'flag provided but not defined: -json' >&2\n  echo 'usage: crew remote pair [--name n] [--url u] | devices | revoke <id>' >&2\n  exit 2\n".to_string()
    };
    format!(
        "#!/bin/sh\necho \"crew $*\" >> '{log}'\nif [ \"$1\" = version ]; then\n  echo 'crew v{version} (commit abc)'\n  exit 0\nfi\nif [ \"$1\" = remote ]; then\n{pair}fi\nexit 0\n",
        log = log.display()
    )
}

fn executable(file: &Path, text: &str) {
    fs::write(file, text).unwrap();
    fs::set_permissions(file, fs::Permissions::from_mode(0o755)).unwrap();
}

fn platform() -> String {
    let os = if std::env::consts::OS == "macos" { "darwin" } else { std::env::consts::OS };
    let arch = if std::env::consts::ARCH == "aarch64" { "arm64" } else { "amd64" };
    format!("{os}_{arch}")
}

fn server(name: &str, installed: Option<&str>) -> (Box, MutexGuard<'static, ()>) {
    let guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let root = std::env::temp_dir().join(format!("crew-desktop-remote-{}-{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&root);
    let home = root.join("home");
    let bin = root.join("bin");
    let release = root.join("release");
    let stage = root.join("stage");
    for dir in [&home.join(".local/bin"), &bin, &release, &stage.join("nvim")] {
        fs::create_dir_all(dir).unwrap();
    }
    let log = root.join("calls.log");
    executable(
        &bin.join("ssh"),
        &format!("#!/bin/sh\nfor a; do last=$a; done\necho \"ssh $last\" >> '{}'\nexec /bin/sh -c \"$last\"\n", log.display()),
    );
    if let Some(version) = installed {
        executable(&home.join(".local/bin/crew"), &crew_script(version, &log, false));
    }
    executable(&stage.join("crew"), &crew_script(APP, &log, true));
    let archive = format!("crew_{}.tar.gz", platform());
    let made = Command::new("tar")
        .args(["-czf", release.join(&archive).to_str().unwrap(), "-C", stage.to_str().unwrap(), "crew", "nvim"])
        .status()
        .unwrap();
    assert!(made.success());
    let sum = Command::new("sh")
        .arg("-c")
        .arg(format!("cd '{}' && (sha256sum {archive} 2>/dev/null || shasum -a 256 {archive}) > checksums.txt", release.display()))
        .status()
        .unwrap();
    assert!(sum.success());
    std::env::set_var("HOME", &home);
    std::env::set_var("XDG_DATA_HOME", home.join(".local/share"));
    std::env::set_var("PATH", format!("{}:/usr/bin:/bin", bin.display()));
    std::env::set_var("CREW_DOWNLOAD_BASE", format!("file://{}", release.display()));
    std::env::remove_var("CREW_INSTALL_DIR");
    (Box { root, log }, guard)
}

fn calls(b: &Box) -> Vec<String> {
    fs::read_to_string(&b.log)
        .unwrap_or_default()
        .lines()
        .filter(|l| l.starts_with("crew "))
        .map(str::to_string)
        .collect()
}

#[test]
fn the_plan_follows_the_version_of_the_server() {
    assert_eq!(plan("missing\n", APP), Plan::Install);
    assert_eq!(plan("crew v0.1.0-beta.6 (commit abc)\n", APP), Plan::Current);
    assert_eq!(plan("crew v0.1.0-beta.2 (commit abc)\n", APP), Plan::Upgrade("v0.1.0-beta.2".into()));
    assert_eq!(plan("crew v0.1.0 (commit abc)\n", APP), Plan::Newer("v0.1.0".into()));
    assert_eq!(plan("crew v0.1.0-beta.2 (commit abc)\n", "0.0.0"), Plan::Current);
    assert_eq!(plan("crew dev (commit abc)\n", APP), Plan::Current);
}

#[test]
fn an_older_crew_is_upgraded_then_the_daemon_stops_then_pairing_works() {
    let (b, _guard) = server("old", Some("0.1.0-beta.2"));
    assert_eq!(ssh_crew("box", APP).unwrap(), Plan::Upgrade("v0.1.0-beta.2".into()));
    ssh_install("box", APP).unwrap();
    let after = fs::read_to_string(b.root.join("home/.local/bin/crew")).unwrap();
    assert!(after.contains(&format!("crew v{APP}")), "crew was not replaced: {after}");
    assert!(calls(&b).iter().any(|c| c == "crew daemon stop"), "calls: {:?}", calls(&b));
    assert_eq!(ssh_crew("box", APP).unwrap(), Plan::Current);
    assert_eq!(ssh_pair_code("box", APP).unwrap(), "ABCD2345");
}

#[test]
fn a_missing_crew_is_installed_in_local_bin() {
    let (b, _guard) = server("missing", None);
    assert_eq!(ssh_crew("box", APP).unwrap(), Plan::Install);
    ssh_install("box", APP).unwrap();
    assert!(b.root.join("home/.local/bin/crew").exists());
    assert_eq!(ssh_crew("box", APP).unwrap(), Plan::Current);
}

#[test]
fn a_newer_crew_is_never_downgraded() {
    let (b, _guard) = server("newer", Some("0.2.0"));
    let err = ssh_crew("box", APP).unwrap_err();
    assert!(err.contains("v0.2.0") && err.contains("Update the app"), "{err}");
    let kept = fs::read_to_string(b.root.join("home/.local/bin/crew")).unwrap();
    assert!(kept.contains("crew v0.2.0"));
}

#[test]
fn an_unknown_pair_flag_says_that_crew_is_too_old() {
    let (_b, _guard) = server("flag", Some("0.1.0-beta.2"));
    let err = ssh_pair_code("box", APP).unwrap_err();
    assert_eq!(err, "crew on box is too old (v0.1.0-beta.2); the app needs v0.1.0-beta.6");
}
