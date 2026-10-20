#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use crew_desktop::local::fix_daemon;

fn fake_crew(name: &str, setup_exit: i32, setup_err: &str, check: &str) -> (PathBuf, PathBuf) {
    let dir = std::env::temp_dir().join(format!("crew-desktop-fix-{}-{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let log = dir.join("calls.log");
    let script = format!(
        "#!/bin/sh\necho \"$*\" >> '{log}'\nif [ \"$3\" = \"--check\" ]; then\n  printf '%s' '{check}'\n  exit 0\nfi\necho '{setup_err}' >&2\nexit {setup_exit}\n",
        log = log.display(),
    );
    let crew = dir.join("crew");
    fs::write(&crew, script).unwrap();
    fs::set_permissions(&crew, fs::Permissions::from_mode(0o755)).unwrap();
    (crew, log)
}

fn calls(log: &Path) -> Vec<String> {
    fs::read_to_string(log)
        .unwrap_or_default()
        .lines()
        .map(str::to_string)
        .collect()
}

#[test]
fn fix_runs_setup_daemon_and_then_the_check() {
    let (crew, log) = fake_crew("ok", 0, "", r#"{"installed":true,"running":true,"failing":false,"reason":""}"#);
    assert_eq!(fix_daemon(&crew), Ok(()));
    assert_eq!(calls(&log), vec!["setup daemon", "setup daemon --check"]);
}

#[test]
fn a_failed_setup_gives_the_reason_of_the_check() {
    let (crew, _) = fake_crew(
        "setupfails",
        1,
        "exit status 1",
        r#"{"installed":true,"running":false,"failing":true,"reason":"the unit runs /usr/local/bin/crew, which does not exist"}"#,
    );
    assert_eq!(
        fix_daemon(&crew),
        Err("the unit runs /usr/local/bin/crew, which does not exist".to_string())
    );
}

#[test]
fn a_daemon_that_still_fails_after_setup_gives_the_reason() {
    let (crew, _) = fake_crew(
        "stillfails",
        0,
        "",
        r#"{"installed":true,"running":false,"failing":true,"reason":"crew-daemon.service restarts in a loop"}"#,
    );
    assert_eq!(
        fix_daemon(&crew),
        Err("crew-daemon.service restarts in a loop".to_string())
    );
}

#[test]
fn a_failed_setup_without_a_reason_gives_its_error_output() {
    let (crew, _) = fake_crew("noreason", 1, "linger is off", "not json");
    assert_eq!(fix_daemon(&crew), Err("linger is off".to_string()));
}

#[test]
fn a_missing_crew_is_an_error() {
    let missing = std::env::temp_dir().join("crew-desktop-fix-missing/crew");
    assert!(fix_daemon(&missing).is_err());
}
