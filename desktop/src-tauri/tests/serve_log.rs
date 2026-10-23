#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::time::Duration;

use crew_desktop::local::{free_port, start_serve, LocalServe};

fn fake_serve(name: &str, body: &str) -> (PathBuf, PathBuf) {
    let dir =
        std::env::temp_dir().join(format!("crew-desktop-log-{}-{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let crew = dir.join("crew");
    let draft = dir.join("crew.draft");
    fs::write(&draft, format!("#!/bin/sh\n{body}\n")).unwrap();
    fs::set_permissions(&draft, fs::Permissions::from_mode(0o755)).unwrap();
    fs::rename(&draft, &crew).unwrap();
    (crew, dir.join("logs").join("serve.log"))
}

#[test]
fn a_serve_that_exits_gives_its_error_output_exit_status_and_log_path() {
    let (crew, log) = fake_serve(
        "exits",
        "echo 'first line' >&2\necho 'crew: daemon socket: permission denied' >&2\nexit 3",
    );
    let mut serve = LocalServe::start(&crew, free_port().unwrap(), &log).unwrap();
    assert!(!serve.wait_ready(Duration::from_secs(10)));
    let problem = serve.problem();
    assert!(
        problem.contains("crew: daemon socket: permission denied"),
        "{problem}"
    );
    assert!(problem.contains("exit status: 3"), "{problem}");
    assert!(problem.contains(&log.display().to_string()), "{problem}");
    assert!(fs::read_to_string(&log)
        .unwrap()
        .contains("permission denied"));
}

#[test]
fn the_problem_keeps_only_the_last_lines_of_a_long_error_output() {
    let (crew, log) = fake_serve(
        "long",
        "i=0\nwhile [ $i -lt 100 ]; do echo \"line $i\" >&2; i=$((i+1)); done\nexit 1",
    );
    let mut serve = LocalServe::start(&crew, free_port().unwrap(), &log).unwrap();
    assert!(!serve.wait_ready(Duration::from_secs(10)));
    let problem = serve.problem();
    assert!(problem.contains("line 99"), "{problem}");
    assert!(!problem.contains("line 50\n"), "{problem}");
}

#[test]
fn a_serve_that_does_not_answer_in_time_says_so() {
    let (crew, log) = fake_serve("slow", "echo 'waiting for tmux' >&2\nexec sleep 30");
    let mut serve = LocalServe::start(&crew, free_port().unwrap(), &log).unwrap();
    assert!(!serve.wait_ready(Duration::from_millis(500)));
    let problem = serve.problem();
    assert!(problem.contains("did not answer"), "{problem}");
    assert!(problem.contains("waiting for tmux"), "{problem}");
}

const OLD_DAEMON: &str = "crew serve: subscribe to the daemon: daemon runs crew 0.1.0-beta.4 but this client is 0.1.0-beta.5; restart the daemon: run `crew daemon stop`; the next command starts the new one";
const NEW_DAEMON: &str = "crew serve: subscribe to the daemon: daemon runs crew 0.1.0-beta.6 but this client is 0.1.0-beta.5; restart this client: it is older than the daemon";

fn mismatch_crew(name: &str, mismatch: &str, after_stop: &str) -> (PathBuf, PathBuf, PathBuf) {
    let dir =
        std::env::temp_dir().join(format!("crew-desktop-log-{}-{}", name, std::process::id()));
    let calls = dir.join("calls.log");
    let stopped = dir.join("stopped");
    let body = format!(
        "echo \"$*\" >> '{calls}'\nif [ \"$1\" = daemon ]; then touch '{stopped}'; exit 0; fi\nif [ ! -e '{stopped}' ]; then echo '{mismatch}' >&2; exit 1; fi\n{after_stop}",
        calls = calls.display(),
        stopped = stopped.display(),
    );
    let (crew, log) = fake_serve(name, &body);
    (crew, log, calls)
}

fn calls(file: &PathBuf) -> Vec<String> {
    fs::read_to_string(file)
        .unwrap_or_default()
        .lines()
        .map(|l| l.split_whitespace().take(2).collect::<Vec<_>>().join(" "))
        .collect()
}

const HELLO: &str = "port=${3##*:}\nexec python3 -c \"import http.server as h,sys\nclass R(h.BaseHTTPRequestHandler):\n  def do_GET(s):\n    s.send_response(200); s.end_headers(); s.wfile.write(b'{}')\nh.HTTPServer(('127.0.0.1', int(sys.argv[1])), R).serve_forever()\" \"$port\"";

#[test]
fn an_older_daemon_is_stopped_and_serve_starts_again() {
    let (crew, log, file) = mismatch_crew("restart", OLD_DAEMON, HELLO);
    let serve = start_serve(&crew, free_port().unwrap(), &log, Duration::from_secs(10));
    assert!(serve.is_ok(), "{:?}", serve.err());
    assert_eq!(
        calls(&file),
        vec!["serve --addr", "daemon stop", "serve --addr"]
    );
}

#[test]
fn a_restart_that_still_fails_names_the_version_mismatch() {
    let still = format!("echo '{OLD_DAEMON}' >&2\nexit 1");
    let (crew, log, file) = mismatch_crew("stillold", OLD_DAEMON, &still);
    let problem = start_serve(&crew, free_port().unwrap(), &log, Duration::from_secs(10))
        .err()
        .unwrap();
    assert!(problem.contains("version mismatch"), "{problem}");
    assert!(problem.contains("0.1.0-beta.4"), "{problem}");
    assert_eq!(
        calls(&file),
        vec!["serve --addr", "daemon stop", "serve --addr"]
    );
}

#[test]
fn a_newer_daemon_is_never_stopped() {
    let (crew, log, file) = mismatch_crew("newer", NEW_DAEMON, "exit 1");
    let problem = start_serve(&crew, free_port().unwrap(), &log, Duration::from_secs(10))
        .err()
        .unwrap();
    assert!(problem.contains("version mismatch"), "{problem}");
    assert_eq!(calls(&file), vec!["serve --addr"]);
}
