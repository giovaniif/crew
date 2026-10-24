use std::fs;
use std::path::PathBuf;

use crew_desktop::machines::{migrate, request_target, scrub, MACHINES_FILE, SERVERS_FILE};
use crew_desktop::servers::{Kind, Store, LOCAL_ID};
use serde_json::{json, Value};

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("crew-desktop-machines-{}-{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

const SERVERS: &str = r#"{
  "servers": [
    {"id": "local", "kind": "local"},
    {"id": "ssh:devbox", "kind": "ssh", "host": "devbox", "auth": {"token": "ssh-secret", "device": {"id": "d1"}}},
    {"id": "url:https://crew.example.ts.net/", "kind": "url", "url": "https://crew.example.ts.net/", "auth": {"token": "url-secret"}}
  ],
  "selected": "ssh:devbox"
}"#;

fn read_json(file: &PathBuf) -> Value {
    serde_json::from_slice(&fs::read(file).unwrap()).unwrap()
}

#[test]
fn the_migration_makes_machines_json_from_servers_json_and_keeps_a_backup() {
    let dir = temp_dir("migrate");
    fs::write(dir.join(SERVERS_FILE), SERVERS).unwrap();
    assert!(migrate(&dir).unwrap());
    let backup = fs::read_to_string(dir.join("servers.json.bak")).unwrap();
    assert_eq!(backup, SERVERS);
    let file = dir.join(MACHINES_FILE);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(fs::metadata(dir.join("servers.json.bak")).unwrap().permissions().mode() & 0o777, 0o600);
    }
    let machines = read_json(&file);
    assert_eq!(machines.get("selected"), None);
    let list = machines["machines"].as_array().unwrap();
    assert_eq!(list.len(), 3);
    assert_eq!(list[0]["id"], "local");
    assert_eq!(list[0]["kind"], "this");
    assert_eq!(list[0]["name"], "This Mac");
    assert_eq!(list[1]["id"], "ssh:devbox");
    assert_eq!(list[1]["kind"], "ssh");
    assert_eq!(list[1]["name"], "devbox");
    assert_eq!(list[1]["ssh_address"], "devbox");
    assert_eq!(list[1]["auth"]["token"], "ssh-secret");
    assert_eq!(list[2]["kind"], "url");
    assert_eq!(list[2]["url"], "https://crew.example.ts.net/");
    assert_eq!(list[2]["auth"]["token"], "url-secret");
}

#[test]
fn a_second_migration_changes_nothing() {
    let dir = temp_dir("again");
    fs::write(dir.join(SERVERS_FILE), SERVERS).unwrap();
    assert!(migrate(&dir).unwrap());
    let first = fs::read(dir.join(MACHINES_FILE)).unwrap();
    fs::write(dir.join(SERVERS_FILE), r#"{"servers":[{"id":"local","kind":"local"}],"selected":"local"}"#).unwrap();
    assert!(!migrate(&dir).unwrap());
    assert_eq!(fs::read(dir.join(MACHINES_FILE)).unwrap(), first);
    assert_eq!(fs::read_to_string(dir.join("servers.json.bak")).unwrap(), SERVERS);
}

#[test]
fn without_servers_json_the_migration_writes_nothing() {
    let dir = temp_dir("none");
    assert!(!migrate(&dir).unwrap());
    assert!(!dir.join(MACHINES_FILE).exists());
    assert!(!dir.join("servers.json.bak").exists());
}

#[test]
fn the_store_loads_the_migrated_machines_with_their_logins() {
    let dir = temp_dir("load");
    fs::write(dir.join(SERVERS_FILE), SERVERS).unwrap();
    migrate(&dir).unwrap();
    let (store, first) = Store::load(&dir.join(MACHINES_FILE));
    assert!(!first);
    assert_eq!(store.selected, LOCAL_ID);
    assert_eq!(store.servers[0].kind, Kind::Local);
    assert_eq!(store.get("ssh:devbox").unwrap().kind, Kind::Ssh { host: "devbox".into() });
    assert_eq!(store.get("ssh:devbox").unwrap().auth.as_ref().unwrap()["token"], "ssh-secret");
    assert_eq!(
        store.get("url:https://crew.example.ts.net/").unwrap().kind,
        Kind::Url { url: "https://crew.example.ts.net/".into() }
    );
}

#[test]
fn a_machine_request_reaches_only_the_api_and_never_pairing() {
    for (method, path) in [
        ("GET", "/api/v1/environments"),
        ("POST", "/api/v1/mates"),
        ("DELETE", "/api/v1/envs/work"),
        ("GET", "/api/v1/fs/complete?path=%2Ftmp"),
    ] {
        assert!(request_target(method, path).is_ok(), "{method} {path}");
    }
    for (method, path) in [
        ("POST", "/api/v1/pair"),
        ("POST", "/api/v1/pair/code"),
        ("POST", "/api/v1/pair?x=1"),
        ("GET", "/api/v1/stream"),
        ("GET", "/api/v1/terminal/%255"),
        ("GET", "/api/v1/../../etc/passwd"),
        ("GET", "/index.html"),
        ("GET", "https://evil.example/api/v1/hello"),
        ("GET", "//evil.example/api/v1/hello"),
        ("PUT", "/api/v1/mates"),
        ("GET", "/api/v1/hello\r\nX: y"),
    ] {
        assert!(request_target(method, path).is_err(), "{method} {path}");
    }
}

#[test]
fn no_answer_to_the_page_has_a_token() {
    let body = json!({"device": {"id": "d1", "token": "abc"}, "token": "abc", "list": [{"token": "x", "name": "n"}]}).to_string();
    let out: Value = serde_json::from_str(&scrub(&body, "machine-token").unwrap()).unwrap();
    assert_eq!(out, json!({"device": {"id": "d1"}, "list": [{"name": "n"}]}));
    assert!(scrub(r#"{"note":"machine-token"}"#, "machine-token").is_err());
    assert!(scrub("not json machine-token", "machine-token").is_err());
    assert_eq!(scrub("plain text", "machine-token").unwrap(), "plain text");
    assert_eq!(scrub("", "machine-token").unwrap(), "");
}
