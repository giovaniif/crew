use std::fs;
use std::path::PathBuf;

use crew_desktop::servers::{
    check_failure, connect_url, pair_argv, server_url, setup_argv, ssh_hosts, ssh_target, tunnel_argv, Kind,
    Store, LOCAL_ID,
};

fn temp_file(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("crew-desktop-servers-{}-{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir.join("servers.json")
}

fn last(argv: &[String]) -> &str {
    argv.last().unwrap()
}

#[test]
fn ssh_hosts_lists_named_hosts_without_wildcards_or_repeats() {
    let config = "Host *\n  ForwardAgent no\nHost box devbox\n  User me\nhost=gpu\nHost web-* !bad ? box\nMatch all\n";
    assert_eq!(ssh_hosts(config), vec!["box", "devbox", "gpu"]);
}

#[test]
fn ssh_target_refuses_options_spaces_and_quotes() {
    assert_eq!(ssh_target("  me@box "), Some("me@box".to_string()));
    assert_eq!(ssh_target("-oProxyCommand=sh"), None);
    assert_eq!(ssh_target("box rm"), None);
    assert_eq!(ssh_target("box'"), None);
    assert_eq!(ssh_target("box\""), None);
    assert_eq!(ssh_target("   "), None);
}

#[test]
fn ssh_commands_use_batch_mode_and_end_the_options_before_the_host() {
    let argv = setup_argv("box");
    assert_eq!(&argv[..2], &["ssh".to_string(), "-T".to_string()]);
    let at = argv.iter().position(|a| a == "--").unwrap();
    assert_eq!(argv[at + 1], "box");
    assert!(argv[..at].windows(2).any(|w| w[0] == "-o" && w[1] == "BatchMode=yes"));
    assert_eq!(argv.len(), at + 3);
}

#[test]
fn setup_runs_crew_setup_daemon_then_its_check_on_the_host() {
    let argv = setup_argv("box");
    let script = last(&argv);
    assert!(script.starts_with("sh -c '"));
    let setup = script.find("crew setup daemon &&").unwrap();
    let check = script.find("crew setup daemon --check").unwrap();
    assert!(setup < check);
    assert!(script.contains("$HOME/.local/bin"));
}

#[test]
fn the_tunnel_forwards_a_local_port_to_crew_serve_on_the_host() {
    let argv = tunnel_argv("box", 5000, 6000);
    let at = argv.iter().position(|a| a == "-L").unwrap();
    assert_eq!(argv[at + 1], "5000:127.0.0.1:6000");
    assert!(argv.windows(2).any(|w| w[0] == "-o" && w[1] == "ExitOnForwardFailure=yes"));
    assert!(last(&argv).contains("crew serve --addr 127.0.0.1:6000 --url http://127.0.0.1:5000"));
}

#[test]
fn pairing_gets_a_code_from_crew_remote_pair_on_the_host() {
    assert!(last(&pair_argv("box")).contains("crew remote pair --json --name desktop"));
}

#[test]
fn check_failure_gives_the_reason_of_a_failing_daemon() {
    assert_eq!(check_failure(r#"{"installed":true,"running":true,"linger":true}"#), None);
    assert_eq!(
        check_failure(r#"{"installed":true,"running":false,"failing":true,"reason":"exec format error"}"#),
        Some("exec format error".to_string())
    );
    assert_eq!(
        check_failure(r#"{"installed":true,"running":false,"linger":true}"#),
        Some("the daemon is installed but not running".to_string())
    );
    assert!(check_failure("bash: crew: command not found").is_some());
}

#[test]
fn server_url_adds_https_and_keeps_only_the_origin() {
    assert_eq!(server_url("crew.example.ts.net"), Some("https://crew.example.ts.net/".to_string()));
    assert_eq!(server_url(" http://box:7420/x?y=1 "), Some("http://box:7420/".to_string()));
    assert_eq!(server_url("ftp://box"), None);
    assert_eq!(server_url(""), None);
}

#[test]
fn mobile_connect_url_is_the_bundled_page_in_change_mode() {
    assert_eq!(connect_url(true), "tauri://localhost/index.html?change");
    assert_eq!(connect_url(false), "http://tauri.localhost/index.html?change");
}

#[test]
fn a_missing_file_is_a_first_run_with_only_this_computer() {
    let (store, first) = Store::load(&temp_file("missing"));
    assert!(first);
    assert_eq!(store.selected, LOCAL_ID);
    assert_eq!(store.servers.len(), 1);
    assert_eq!(store.servers[0].kind, Kind::Local);
}

#[test]
fn adding_the_same_server_again_keeps_one_entry_with_the_new_login() {
    let mut store = Store::load(&temp_file("dedupe")).0;
    let a = store.add(Kind::Ssh { host: "box".into() }, Some(serde_json::json!({"token": "one"})));
    let b = store.add(Kind::Ssh { host: "box".into() }, Some(serde_json::json!({"token": "two"})));
    assert_eq!(a, b);
    assert_eq!(store.servers.len(), 2);
    assert_eq!(store.get(&a).unwrap().auth.as_ref().unwrap()["token"], "two");
}

#[test]
fn this_computer_cannot_be_removed_and_removing_the_selected_server_selects_it() {
    let mut store = Store::load(&temp_file("remove")).0;
    let id = store.add(Kind::Url { url: "https://crew.example.ts.net/".into() }, None);
    store.select(&id).unwrap();
    assert!(store.remove(LOCAL_ID).is_err());
    store.remove(&id).unwrap();
    assert_eq!(store.selected, LOCAL_ID);
    assert!(store.get(&id).is_none());
    assert!(store.remove("nope").is_err());
    assert!(store.select("nope").is_err());
}

#[test]
fn the_saved_file_is_private_and_loads_back_with_the_logins() {
    let file = temp_file("save");
    let mut store = Store::load(&file).0;
    let id = store.add(Kind::Ssh { host: "box".into() }, Some(serde_json::json!({"token": "secret"})));
    store.select(&id).unwrap();
    store.save(&file).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
    }
    let (loaded, first) = Store::load(&file);
    assert!(!first);
    assert_eq!(loaded.selected, id);
    assert_eq!(loaded.get(&id).unwrap().auth.as_ref().unwrap()["token"], "secret");
}

#[test]
fn the_rows_for_the_page_have_no_logins() {
    let mut store = Store::load(&temp_file("rows")).0;
    store.add(Kind::Ssh { host: "box".into() }, Some(serde_json::json!({"token": "secret"})));
    let rows = serde_json::to_string(&store.rows()).unwrap();
    assert!(!rows.contains("secret"));
    assert!(rows.contains(r#""name":"box""#));
    assert!(rows.contains(r#""name":"This computer""#));
}
